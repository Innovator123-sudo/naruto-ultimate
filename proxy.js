
const http = require('http');

const PORT = 3000;
const TARGET_BASE_URL = 'https://dbc-90184055-f8d5.cloud.databricks.com';

// ── Absolute max tokens ──
const MAX_TOKENS = 25000;

// ── In-memory request queue for concurrency control ──
const activeRequests = new Set();
const MAX_CONCURRENT = 10;

// ── Lightweight LRU response cache (non-streaming GET/health checks) ──
const cache = new Map();
const CACHE_MAX = 50;
const CACHE_TTL_MS = 30_000;

function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
    return entry.value;
}
function cacheSet(key, value) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { value, ts: Date.now() });
}

// ── Retry with exponential back-off ──
async function fetchWithRetry(url, opts, retries = 2) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try { return await fetch(url, opts); }
        catch (e) {
            lastErr = e;
            if (i < retries - 1) await new Promise(r => setTimeout(r, 50 * 2 ** i));
        }
    }
    throw lastErr;
}

const server = http.createServer(async (req, res) => {
    // ── CORS ──
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // ── Concurrency gate ──
    if (activeRequests.size >= MAX_CONCURRENT) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Too many concurrent requests', active: activeRequests.size }));
        return;
    }
    const reqId = Symbol();
    activeRequests.add(reqId);

    let headersSent = false;

    try {
        // ── Read body with timeout ──
        const chunks = [];
        await Promise.race([
            (async () => { for await (const c of req) chunks.push(c); })(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('Body read timeout')), 30_000))
        ]);
        let requestBody = Buffer.concat(chunks);

        // ── Boost POST: max tokens, streaming, aggressive performance settings ──
        if (req.method === 'POST') {
            try {
                const parsed = JSON.parse(requestBody.toString());

                parsed.max_tokens = MAX_TOKENS;
                parsed.stream = true;

                // 🔥 Full-power settings
                if (parsed.temperature === undefined) parsed.temperature = 0.2;   // sharp + fast
                if (parsed.top_p === undefined)       parsed.top_p = 0.95;
                if (parsed.top_k === undefined)       parsed.top_k = 40;

                // Strip system prompt padding that wastes tokens
                if (Array.isArray(parsed.messages)) {
                    parsed.messages = parsed.messages.map(m => ({
                        ...m,
                        content: typeof m.content === 'string'
                            ? m.content.trimEnd()
                            : m.content
                    }));
                }

                requestBody = Buffer.from(JSON.stringify(parsed));
            } catch (_) { /* not JSON — pass through */ }
        }

        // ── Build target URL ──
        const targetUrl = TARGET_BASE_URL.replace(/\/+$/, '') + req.url;

        // ── Cache hit for safe GET requests ──
        if (req.method === 'GET') {
            const cached = cacheGet(targetUrl);
            if (cached) {
                res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'HIT' });
                res.end(cached);
                return;
            }
        }

        // ── Forward headers ──
        const fwdHeaders = { ...req.headers };
        delete fwdHeaders.host;
        delete fwdHeaders.connection;
        delete fwdHeaders['content-length'];
        fwdHeaders['content-length'] = String(requestBody.length);
        fwdHeaders['accept-encoding'] = 'identity'; // no gzip — faster decode

        // ── Fire request ──
        const response = await fetchWithRetry(targetUrl, {
            method: req.method,
            headers: fwdHeaders,
            body: req.method !== 'GET' && req.method !== 'HEAD' ? requestBody : undefined,
        });

        // ── Forward response headers ──
        const resHeaders = Object.fromEntries(response.headers.entries());
        delete resHeaders['content-encoding'];
        delete resHeaders['transfer-encoding'];
        resHeaders['x-proxy-latency'] = String(Date.now()); // debug stamp
        res.writeHead(response.status, resHeaders);
        headersSent = true;

        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('text/event-stream')) {
            // ── SSE streaming: zero-copy fast path ──
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            // Flush helper — write immediately, no buffering
            const flush = (data) => { try { res.write(data); } catch (_) {} };

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        const trimmed = line.trim();

                        if (!trimmed.startsWith('data: ')) {
                            flush(line + '\n');
                            continue;
                        }

                        const dataStr = trimmed.slice(6).trim();
                        if (dataStr === '[DONE]') {
                            flush('data: [DONE]\n\n');
                            continue;
                        }

                        try {
                            const obj = JSON.parse(dataStr);

                            // 🔥 Flatten array delta.content → string
                            const delta = obj.choices?.[0]?.delta;
                            if (delta && Array.isArray(delta.content)) {
                                let text = '';
                                for (const item of delta.content) {
                                    if (item.type === 'reasoning' && item.summary) {
                                        text += item.summary.map(s => s.text || '').join('');
                                    } else if (item.type === 'text' && item.text) {
                                        text += item.text;
                                    } else if (item.text) {
                                        text += item.text;
                                    }
                                }
                                delta.content = text;
                            }

                            flush(`data: ${JSON.stringify(obj)}\n\n`);
                        } catch (_) {
                            flush(line + '\n');
                        }
                    }
                }
            } catch (streamErr) {
                console.warn('⚠ Stream interrupted:', streamErr.message);
            }

            if (buffer.length > 0) flush(buffer);
            res.end();

        } else {
            // ── Non-streaming: buffer + optional cache ──
            const arrayBuffer = await response.arrayBuffer();
            const buf = Buffer.from(arrayBuffer);

            if (req.method === 'GET' && response.status === 200) {
                cacheSet(targetUrl, buf);
            }

            res.end(buf);
        }

    } catch (err) {
        console.error('✖ Proxy error:', err.message);
        if (!headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Proxy Error', message: err.message }));
        } else {
            res.end();
        }
    } finally {
        activeRequests.delete(reqId);
    }
});

// ── Tuned keep-alive for low-latency reuse ──
server.keepAliveTimeout = 10_000;
server.headersTimeout   = 15_000;
server.timeout          = 120_000;
server.maxConnections   = 200;

// ── Graceful shutdown ──
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { server.close(() => process.exit(0)); });

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
⚡ Cline Proxy  →  http://localhost:${PORT}
   Target      :  ${TARGET_BASE_URL}
   Max tokens  :  ${MAX_TOKENS}
   Streaming   :  forced ON
   Temperature :  0.2  (sharp + fast)
   Concurrency :  up to ${MAX_CONCURRENT} parallel requests
   Cache       :  ${CACHE_MAX} GET entries / ${CACHE_TTL_MS / 1000}s TTL
   Retries     :  3× with back-off

   Set Cline Base URL to: http://localhost:${PORT}
`);
});
