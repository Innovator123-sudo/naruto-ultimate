const http = require('http');

const PORT = 3000;
const TARGET_BASE_URL = 'https://dbc-90184055-f8d5.cloud.databricks.com';
const MAX_TOKENS = 25000;
const VALID_REASONING_EFFORT = new Set(['minimal', 'low', 'medium', 'high', 'max', 'none', 'disabled']);
const MAX_RETRIES = 4;
const RETRY_BASE_MS = 500;

const server = http.createServer(async (req, res) => {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    try {
        let body = [];
        for await (const chunk of req) {
            body.push(chunk);
        }
        // ✅ Use 'let' so we can reassign after JSON manipulation
        let requestBody = Buffer.concat(body);

        // ── Tune POST body for speed + quality ──
        if (req.method === 'POST' && requestBody.length > 0) {
            try {
                const parsed = JSON.parse(requestBody.toString());

                parsed.max_tokens = MAX_TOKENS;
                parsed.stream = true;

                if (parsed.reasoning_effort !== undefined) {
                    parsed.reasoning_effort = 'low'; // Force fast replies
                }

                parsed.temperature = 0.1;
                parsed.top_p = 0.95;

                if (Array.isArray(parsed.messages)) {
                    parsed.messages = parsed.messages.map(m => ({
                        ...m,
                        content: typeof m.content === 'string'
                            ? m.content.trim()
                            : m.content
                    }));
                }

                requestBody = Buffer.from(JSON.stringify(parsed));
            } catch (_) {
            }
        }

        // Remove trailing slash from base url if it exists to prevent double slashes
        const base = TARGET_BASE_URL.endsWith('/') ? TARGET_BASE_URL.slice(0, -1) : TARGET_BASE_URL;
        const targetUrl = base + req.url;

        const headers = { ...req.headers };
        delete headers.host;
        delete headers.connection;
        delete headers['content-length'];

        let response;
        let lastErr;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                response = await fetch(targetUrl, {
                    method: req.method,
                    headers: headers,
                    body: req.method !== 'GET' && req.method !== 'HEAD' ? requestBody : undefined,
                });
                if (response.status !== 429) break;

                // If it is a 429, consume the body to free the socket if we're going to retry
                if (attempt < MAX_RETRIES - 1) {
                    try {
                        await response.text();
                    } catch (e) { }
                } else {
                    break;
                }
            } catch (e) {
                lastErr = e;
            }
            if (attempt < MAX_RETRIES - 1) {
                // Exponential backoff with jitter, capped at 3 seconds to prevent long hangs
                const jitter = Math.random() * 500;
                const delay = Math.min((RETRY_BASE_MS * (2 ** attempt)) + jitter, 3000);
                await new Promise(r => setTimeout(r, delay));
            }
        }
        if (!response) throw lastErr || new Error('Request failed');

        // Check if response is still usable before proceeding
        if (!response.body) {
            throw new Error('Response body is not available');
        }

        // Forward status and headers
        const resHeaders = Object.fromEntries(response.headers.entries());
        delete resHeaders['content-encoding']; // Let Node handle encoding automatically
        res.writeHead(response.status, resHeaders);

        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('text/event-stream')) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                let lines = buffer.split('\n');
                buffer = lines.pop(); // keep incomplete line

                for (let line of lines) {
                    if (line.trim().startsWith('data: ')) {
                        const dataStr = line.substring(line.indexOf('data: ') + 6).trim();
                        if (dataStr === '[DONE]') {
                            res.write(`data: [DONE]\n\n`);
                            continue;
                        }
                        try {
                            const parsed = JSON.parse(dataStr);

                            // 🔥 THE FIX: If delta.content is an array, flatten it into a string!
                            if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && Array.isArray(parsed.choices[0].delta.content)) {
                                let textContent = '';
                                for (const item of parsed.choices[0].delta.content) {
                                    if (item.type === 'reasoning' && item.summary) {
                                        textContent += item.summary.map(s => s.text || '').join('');
                                    } else if (item.text) {
                                        textContent += item.text;
                                    } else if (item.type === 'text') {
                                        textContent += item.text;
                                    }
                                }
                                // Overwrite the array with our flattened string
                                parsed.choices[0].delta.content = textContent;
                            }

                            res.write(`data: ${JSON.stringify(parsed)}\n\n`);
                        } catch (e) {
                            // If parsing fails, just send the original line
                            res.write(`${line}\n`);
                        }
                    } else {
                        res.write(`${line}\n`);
                    }
                }
            }
            if (buffer.length > 0) {
                res.write(buffer);
            }
            res.end();
        } else {
            // Normal response (not streaming)
            const arrayBuffer = await response.arrayBuffer();
            res.write(Buffer.from(arrayBuffer));
            res.end();
        }

    } catch (err) {
        console.error(err);
        if (!res.headersSent) {
            res.writeHead(500);
            res.end('Proxy Error: ' + err.message);
        } else {
            res.end();
        }
    }
});

server.listen(PORT, () => {
    console.log(`\n🚀 Cline Compatibility Proxy running on http://localhost:${PORT}`);
    console.log(`\n✅ TO USE THIS IN CLINE:`);
    console.log(`1. Change your Base URL in Cline Settings to: http://localhost:${PORT}`);
    console.log(`2. Keep your API Key the same.`);
    console.log(`3. Ensure TARGET_BASE_URL inside this script is your actual Databricks URL!\n`);
});

// ── Clear error if port is already in use ──
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${PORT} is already in use!`);
        console.error(`   Run this to free it: npx kill-port ${PORT}`);
        console.error(`   Then restart the proxy.\n`);
    } else {
        console.error('Server error:', err.message);
    }
    process.exit(1);
});

// ── Graceful shutdown ──
process.on('SIGINT', () => { console.log('\n👋 Proxy stopped.'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
