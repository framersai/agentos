import { createServer } from 'http';
import { AgentOS } from '../AgentOS.js';
export class AgentOSServer {
    constructor(agentOSConfig, serverConfig) {
        this.config = serverConfig;
        this.agentOS = new AgentOS();
        this.agentReady = this.agentOS.initialize(agentOSConfig);
        this.server = createServer((req, res) => this.handleRequest(req, res));
    }
    async handleRequest(req, res) {
        try {
            await this.agentReady;
        }
        catch (error) {
            this.sendJson(res, 500, { error: 'AgentOS failed to initialise', details: error.message });
            return;
        }
        // Basic CORS handling for development/testing.
        if (this.config.enableCors) {
            res.setHeader('Access-Control-Allow-Origin', this.config.corsOrigin ?? '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        }
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        const url = new URL(req.url ?? '/', `http://${req.headers.host || this.config.host || 'localhost'}`);
        if (req.method === 'GET' && url.pathname === '/health') {
            this.sendJson(res, 200, { status: 'ok', service: 'agentos-server' });
            return;
        }
        if (req.method === 'GET' && url.pathname === '/api/agentos/personas') {
            await this.handleListPersonasRequest(url, res);
            return;
        }
        if (req.method === 'POST' && url.pathname === '/api/agentos/chat') {
            await this.handleChatRequest(req, res);
            return;
        }
        this.sendJson(res, 404, { error: 'Not Found' });
    }
    async handleListPersonasRequest(url, res) {
        try {
            const userId = url.searchParams.get('userId') ?? undefined;
            const personas = await this.agentOS.listAvailablePersonas(userId);
            this.sendJson(res, 200, { personas });
        }
        catch (error) {
            this.sendJson(res, 500, { error: 'Failed to list personas', details: error.message });
        }
    }
    async handleChatRequest(req, res) {
        let payload;
        try {
            const rawBody = await this.readBody(req);
            payload = JSON.parse(rawBody || '{}');
        }
        catch (error) {
            this.sendJson(res, 400, { error: 'Invalid JSON body', details: error.message });
            return;
        }
        if (!payload.text || typeof payload.text !== 'string') {
            this.sendJson(res, 400, { error: 'Missing text field in request body.' });
            return;
        }
        const agentInput = {
            userId: payload.userId ?? 'anonymous_user',
            sessionId: payload.sessionId ?? `session_${Date.now()}`,
            conversationId: payload.conversationId,
            selectedPersonaId: payload.personaId,
            textInput: payload.text,
            options: payload.options,
        };
        try {
            const chunks = [];
            for await (const chunk of this.agentOS.processRequest(agentInput)) {
                chunks.push(chunk);
            }
            this.sendJson(res, 200, { chunks });
        }
        catch (error) {
            this.sendJson(res, 500, { error: 'AgentOS processing failed', details: error.message });
        }
    }
    readBody(req) {
        return new Promise((resolve, reject) => {
            const maxBytes = this.parseSizeToBytes(this.config.maxRequestSize ?? '1mb');
            let received = 0;
            const chunks = [];
            req.on('data', (chunk) => {
                received += chunk.length;
                if (received > maxBytes) {
                    req.destroy();
                    reject(new Error('Request body too large'));
                    return;
                }
                chunks.push(Buffer.from(chunk));
            });
            req.on('end', () => {
                resolve(Buffer.concat(chunks).toString('utf8'));
            });
            req.on('error', (error) => reject(error));
        });
    }
    parseSizeToBytes(value) {
        const match = value.trim().toLowerCase().match(/^(\d+)(b|kb|mb|gb)?$/);
        if (!match)
            return 1024 * 1024; // default 1MB
        const size = Number(match[1]);
        const unit = match[2] ?? 'b';
        switch (unit) {
            case 'gb':
                return size * 1024 * 1024 * 1024;
            case 'mb':
                return size * 1024 * 1024;
            case 'kb':
                return size * 1024;
            default:
                return size;
        }
    }
    sendJson(res, status, body) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
    }
    async start() {
        await this.agentReady;
        const port = this.config.port ?? 3001;
        const host = this.config.host ?? '0.0.0.0';
        await new Promise((resolve) => {
            this.server.listen(port, host, () => resolve());
        });
    }
    async stop() {
        await new Promise((resolve) => this.server.close(() => resolve()));
        await this.agentOS.shutdown();
    }
    getServer() {
        return this.server;
    }
}
//# sourceMappingURL=AgentOSServer.js.map