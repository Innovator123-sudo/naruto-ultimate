#!/usr/bin/env node
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const http = require('http');

const PORT = 3000;
const TARGET_BASE_URL = process.env.TARGET_BASE_URL || 'https://dbc-90184055-f8d5.cloud.databricks.com';
const MAX_TOKENS = 25000;
const VALID_REASONING_EFFORT = new Set(['minimal', 'low', 'medium', 'high', 'max', 'none', 'disabled']);
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function fixRequestBody(parsed) {
    parsed.max_tokens = MAX_TOKENS;
    parsed.stream = true;

    if (parsed.reasoning_effort !== undefined) {
        const effort = typeof parsed.reasoning_effort === 'string'
            ? parsed.reasoning_effort.toLowerCase()
            : String(parsed.reasoning_effort);
        if (!VALID_REASONING_EFFORT.has(effort)) {
            delete parsed.reasoning_effort;
        } else {
            parsed.reasoning_effort = effort;
        }
    }

    parsed.temperature = 0.1;
    parsed.top_p = 0.95;

    if (Array.isArray(parsed.messages)) {
        parsed.messages = parsed.messages.map(m => ({
            ...m,
            content: typeof m.content === 'string' ? m.content.trim() : m.content
        }));
    }
    return parsed;
}

function forwardRequest(reqBody) {
    return new Promise((resolve, reject) => {
        const url = new URL(TARGET_BASE_URL);
        const opts = {
            hostname: url.hostname,
            port: url.port || 443,
            path: '/serving-endpoints/chat/completions/invocations',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(reqBody)
            }
        };
        const lib = url.protocol === 'https:' ? require('https') : require('http');
        const upstream = lib.request(opts, (upRes) => {
            const chunks = [];
            upRes.on('data', c => chunks.push(c));
            upRes.on('end', () => {
                const body = Buffer.concat(chunks).toString();
                resolve({ status: upRes.statusCode, headers: upRes.headers, body });
            });
        });
        upstream.on('error', reject);
        upstream.write(reqBody);
        upstream.end();
    });
}

async function callWithRetry(parsedBody, logger) {
    const bodyStr = JSON.stringify(parsedBody);
    let lastErr;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            logger(`[retry-proxy] attempt ${attempt + 1}/${MAX_RETRIES}`);
            const res = await forwardRequest(bodyStr);
            if (res.status === 429 || /REQUEST_LIMIT_EXCEEDED/i.test(res.body)) {
                const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
                logger(`[retry-proxy] rate-limited (${res.status}) → waiting ${wait}ms`);
                lastErr = new Error(`REQUEST_LIMIT_EXCEEDED (attempt ${attempt + 1})`);
                if (attempt < MAX_RETRIES - 1) await sleep(wait);
                continue;
            }
            if (res.status >= 500) {
                const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
                logger(`[retry-proxy] server error ${res.status} → waiting ${wait}ms`);
                lastErr = new Error(`Upstream ${res.status} (attempt ${attempt + 1})`);
                if (attempt < MAX_RETRIES - 1) await sleep(wait);
                continue;
            }
            return res;
        } catch (e) {
            lastErr = e;
            const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
            logger(`[retry-proxy] network error: ${e.message} → waiting ${wait}ms`);
            if (attempt < MAX_RETRIES - 1) await sleep(wait);
        }
    }
    throw lastErr || new Error('All retries exhausted');
}

const server = new Server(
    { name: 'retry-proxy', version: '1.0.0' },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'chat_completion',
            description: 'Forward a chat-completion request to the Databricks endpoint. Auto-retries on REQUEST_LIMIT_EXCEEDED with exponential backoff.',
            inputSchema: {
                type: 'object',
                properties: {
                    body: { type: 'object', description: 'OpenAI-style chat completion body (model, messages, etc.)' }
                },
                required: ['body']
            }
        },
        {
            name: 'sequential_thinking',
            description: 'Run a sequence of reasoning steps to solve a problem, with retry-aware execution.',
            inputSchema: {
                type: 'object',
                properties: {
                    steps: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                thought: { type: 'string' },
                                action: { type: 'string', enum: ['think', 'call_llm', 'observe'] }
                            }
                        }
                    }
                },
                required: ['steps']
            }
        }
    ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const log = (msg) => process.stderr.write(msg + '\n');

    if (name === 'chat_completion') {
        const parsed = fixRequestBody(args.body);
        const res = await callWithRetry(parsed, log);
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    status: res.status,
                    body: safeJson(res.body)
                }, null, 2)
            }]
        };
    }

    if (name === 'sequential_thinking') {
        const trace = [];
        for (const step of args.steps) {
            trace.push({ ts: Date.now(), ...step });
            if (step.action === 'call_llm') {
                const res = await callWithRetry(fixRequestBody({ messages: [{ role: 'user', content: step.thought }] }), log);
                trace.push({ ts: Date.now(), observation: safeJson(res.body) });
            }
        }
        return { content: [{ type: 'text', text: JSON.stringify(trace, null, 2) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
});

function safeJson(s) {
    try { return JSON.parse(s); } catch { return s; }
}

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('retry-proxy MCP server running on stdio\n');
}

main().catch(err => {
    process.stderr.write('Fatal: ' + err.message + '\n');
    process.exit(1);
});
