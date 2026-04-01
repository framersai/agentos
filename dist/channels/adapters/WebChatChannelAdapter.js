/**
 * @fileoverview WebChat Channel Adapter for AgentOS.
 *
 * Provides a built-in HTTP/WebSocket server for embedding a chat widget
 * directly in web applications. No external SDK is required — this adapter
 * uses Node.js built-in `http` and the `ws` package for WebSocket support.
 *
 * **Modes of operation**:
 * - **Standalone**: Creates its own HTTP server on a configurable port.
 * - **Attached**: Attaches to an existing HTTP server (e.g., Express, Fastify).
 *
 * **Dependencies**: Requires the `ws` npm package for WebSocket support.
 * Uses a dynamic import so the package is only loaded at connection time.
 *
 * @example
 * ```typescript
 * // Standalone mode
 * const webchat = new WebChatChannelAdapter();
 * await webchat.initialize({
 *   platform: 'webchat',
 *   credential: 'optional-api-key',
 *   params: {
 *     port: '8080',
 *     corsOrigins: '*',
 *   },
 * });
 *
 * // Attached mode (with existing Express server)
 * const webchat = new WebChatChannelAdapter();
 * webchat.attachToServer(existingHttpServer);
 * await webchat.initialize({
 *   platform: 'webchat',
 *   credential: 'optional-api-key',
 *   params: { corsOrigins: 'https://myapp.com' },
 * });
 * ```
 *
 * @module @framers/agentos/channels/adapters/WebChatChannelAdapter
 */
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
// ============================================================================
// WebChatChannelAdapter
// ============================================================================
/**
 * Channel adapter for web-based chat using HTTP/WebSocket.
 *
 * Uses dynamic import for the `ws` package so it is only required
 * at runtime when the adapter is actually initialized.
 *
 * Capabilities: text, rich_text, images, buttons, typing_indicator,
 * read_receipts.
 */
export class WebChatChannelAdapter extends BaseChannelAdapter {
    constructor() {
        super(...arguments);
        this.platform = 'webchat';
        this.displayName = 'WebChat';
        this.capabilities = [
            'text',
            'rich_text',
            'images',
            'buttons',
            'typing_indicator',
            'read_receipts',
        ];
        /** Connected clients, keyed by client ID. */
        this.clients = new Map();
        /** Whether we created the HTTP server ourselves (vs attached). */
        this.ownServer = false;
        /** API key for client authentication. Empty string means no auth required. */
        this.apiKey = '';
        /** Allowed CORS origins. */
        this.corsOrigins = '*';
        /** Counter for generating client IDs. */
        this.clientIdCounter = 0;
    }
    // ── Public: Server attachment ──
    /**
     * Attach to an existing HTTP server instead of creating a standalone one.
     * Must be called before {@link initialize}.
     *
     * @param server - Node.js http.Server instance (e.g., from Express).
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attachToServer(server) {
        this.externalServer = server;
    }
    // ── Abstract hook implementations ──
    async doConnect(auth) {
        const params = auth.params ?? {};
        this.apiKey = params.apiKey ?? auth.credential ?? '';
        this.corsOrigins = params.corsOrigins ?? '*';
        const port = parseInt(params.port ?? '8080', 10);
        const wsPath = params.wsPath ?? '/ws';
        // Dynamic import for ws package
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let WsModule;
        try {
            WsModule = await import('ws');
        }
        catch {
            throw new Error('The "ws" package is required for the WebChat adapter. ' +
                'Install it with: npm install ws');
        }
        const WebSocketServer = WsModule.WebSocketServer ?? WsModule.Server ?? WsModule.default?.WebSocketServer ?? WsModule.default?.Server;
        // Create or reuse HTTP server
        if (this.externalServer) {
            // Attached mode — use provided server
            this.httpServer = this.externalServer;
            this.ownServer = false;
        }
        else {
            // Standalone mode — create our own HTTP server
            const http = await import('http');
            this.httpServer = http.createServer((req, res) => {
                this.handleHttpRequest(req, res);
            });
            this.ownServer = true;
        }
        // Create WebSocket server attached to HTTP server
        this.wss = new WebSocketServer({
            server: this.httpServer,
            path: wsPath,
        });
        // Wire up WebSocket events
        this.wss.on('connection', (ws, req) => {
            this.handleNewConnection(ws, req);
        });
        // Start HTTP server if we own it
        if (this.ownServer) {
            await new Promise((resolve, reject) => {
                const listenTimeout = setTimeout(() => {
                    reject(new Error(`WebChat HTTP server failed to start on port ${port} within 10s`));
                }, 10000);
                this.httpServer.listen(port, () => {
                    clearTimeout(listenTimeout);
                    resolve();
                });
                this.httpServer.on('error', (err) => {
                    clearTimeout(listenTimeout);
                    reject(err);
                });
            });
        }
        this.platformInfo = {
            port: this.ownServer ? port : 'attached',
            wsPath,
            corsOrigins: this.corsOrigins,
            requiresAuth: !!this.apiKey,
        };
        console.log(`[WebChat] ${this.ownServer ? `Server started on port ${port}` : 'Attached to existing server'} (ws: ${wsPath}, auth: ${this.apiKey ? 'required' : 'none'})`);
    }
    async doSendMessage(conversationId, content) {
        // Find all clients in this conversation
        const targets = [];
        for (const client of this.clients.values()) {
            if (client.conversationId === conversationId && client.authenticated) {
                targets.push(client);
            }
        }
        if (targets.length === 0) {
            throw new Error(`[WebChat] No connected clients for conversation ${conversationId}.`);
        }
        const messageId = this.generateMessageId();
        const timestamp = new Date().toISOString();
        const outbound = {
            type: 'message',
            messageId,
            blocks: content.blocks,
            text: content.blocks
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('\n'),
            timestamp,
            replyToMessageId: content.replyToMessageId,
        };
        const payload = JSON.stringify(outbound);
        for (const client of targets) {
            this.safeSend(client.ws, payload);
        }
        return { messageId, timestamp };
    }
    async doShutdown() {
        // Close all client connections
        for (const client of this.clients.values()) {
            try {
                client.ws.close(1001, 'Server shutting down');
            }
            catch {
                // Best effort
            }
        }
        this.clients.clear();
        // Close WebSocket server
        if (this.wss) {
            try {
                this.wss.close();
            }
            catch {
                // Best effort
            }
            this.wss = undefined;
        }
        // Close HTTP server only if we own it
        if (this.httpServer && this.ownServer) {
            await new Promise((resolve) => {
                this.httpServer.close(() => resolve());
                // Force resolve after 5s if server doesn't close cleanly
                setTimeout(resolve, 5000);
            });
        }
        this.httpServer = undefined;
        this.externalServer = undefined;
        this.ownServer = false;
        console.log('[WebChat] Adapter shut down.');
    }
    // ── IChannelAdapter optional methods ──
    async sendTypingIndicator(conversationId, isTyping) {
        const outbound = {
            type: 'typing',
            timestamp: new Date().toISOString(),
        };
        // Add isTyping to the payload (not in the strict type but useful)
        const payload = JSON.stringify({ ...outbound, isTyping });
        for (const client of this.clients.values()) {
            if (client.conversationId === conversationId && client.authenticated) {
                this.safeSend(client.ws, payload);
            }
        }
    }
    async getConversationInfo(conversationId) {
        let memberCount = 0;
        for (const client of this.clients.values()) {
            if (client.conversationId === conversationId) {
                memberCount++;
            }
        }
        return {
            name: `WebChat ${conversationId}`,
            memberCount,
            isGroup: memberCount > 1,
            metadata: { platform: 'webchat' },
        };
    }
    // ── Public: Accessors ──
    /** Get the number of currently connected clients. */
    getConnectedClientCount() {
        return this.clients.size;
    }
    /** Get all connected client IDs. */
    getConnectedClientIds() {
        return [...this.clients.keys()];
    }
    /**
     * Broadcast a message to ALL connected and authenticated clients.
     */
    async broadcast(content) {
        const messageId = this.generateMessageId();
        const timestamp = new Date().toISOString();
        const outbound = {
            type: 'message',
            messageId,
            blocks: content.blocks,
            text: content.blocks
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('\n'),
            timestamp,
        };
        const payload = JSON.stringify(outbound);
        for (const client of this.clients.values()) {
            if (client.authenticated) {
                this.safeSend(client.ws, payload);
            }
        }
    }
    // ── Private: HTTP ──
    /**
     * Handle plain HTTP requests (standalone mode only).
     * Provides a simple health-check endpoint and CORS headers.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleHttpRequest(req, res) {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', this.corsOrigins);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.url === '/health' || req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                platform: 'webchat',
                clients: this.clients.size,
                uptime: this.connectedSince
                    ? Date.now() - new Date(this.connectedSince).getTime()
                    : 0,
            }));
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
    // ── Private: WebSocket ──
    /**
     * Handle a new WebSocket connection.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleNewConnection(ws, req) {
        const clientId = this.generateClientId();
        const client = {
            id: clientId,
            ws,
            conversationId: clientId, // Default conversation is 1:1 with this client
            connectedAt: new Date().toISOString(),
            authenticated: !this.apiKey, // Auto-authenticated if no API key required
        };
        this.clients.set(clientId, client);
        console.log(`[WebChat] Client ${clientId} connected (${this.clients.size} total, auth: ${client.authenticated ? 'yes' : 'pending'})`);
        // If no auth required, emit connection event immediately
        if (client.authenticated) {
            this.emit({
                type: 'member_joined',
                platform: 'webchat',
                conversationId: client.conversationId,
                timestamp: client.connectedAt,
                data: { clientId, user: client.user },
            });
        }
        // Wire up message handler
        ws.on('message', (data) => {
            this.handleClientMessage(client, data);
        });
        ws.on('close', () => {
            this.handleClientDisconnect(client);
        });
        ws.on('error', (err) => {
            console.error(`[WebChat] Client ${clientId} error:`, err.message);
            this.handleClientDisconnect(client);
        });
        // Send welcome/auth-required message
        if (!client.authenticated) {
            this.safeSend(ws, JSON.stringify({
                type: 'auth_result',
                authenticated: false,
                error: 'Authentication required. Send { type: "auth", apiKey: "..." }.',
                timestamp: new Date().toISOString(),
            }));
        }
    }
    /**
     * Handle a message from a connected WebSocket client.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleClientMessage(client, rawData) {
        let msg;
        try {
            const text = typeof rawData === 'string' ? rawData : rawData.toString();
            msg = JSON.parse(text);
        }
        catch {
            this.safeSend(client.ws, JSON.stringify({
                type: 'error',
                error: 'Invalid JSON',
                timestamp: new Date().toISOString(),
            }));
            return;
        }
        switch (msg.type) {
            case 'auth': {
                this.handleAuth(client, msg);
                break;
            }
            case 'message': {
                if (!client.authenticated) {
                    this.safeSend(client.ws, JSON.stringify({
                        type: 'error',
                        error: 'Not authenticated',
                        timestamp: new Date().toISOString(),
                    }));
                    return;
                }
                this.handleInboundChatMessage(client, msg);
                break;
            }
            case 'typing': {
                if (!client.authenticated)
                    return;
                this.emit({
                    type: 'typing',
                    platform: 'webchat',
                    conversationId: msg.conversationId ?? client.conversationId,
                    timestamp: new Date().toISOString(),
                    data: {
                        userId: client.user?.id ?? client.id,
                        isTyping: msg.isTyping ?? true,
                    },
                });
                break;
            }
            case 'ping': {
                this.safeSend(client.ws, JSON.stringify({
                    type: 'pong',
                    timestamp: new Date().toISOString(),
                }));
                break;
            }
            default:
                break;
        }
    }
    /**
     * Handle client authentication.
     */
    handleAuth(client, msg) {
        if (!this.apiKey || msg.apiKey === this.apiKey) {
            client.authenticated = true;
            // Update user info if provided
            if (msg.user) {
                client.user = msg.user;
            }
            // Update conversation ID if provided
            if (msg.conversationId) {
                client.conversationId = msg.conversationId;
            }
            this.safeSend(client.ws, JSON.stringify({
                type: 'auth_result',
                authenticated: true,
                timestamp: new Date().toISOString(),
            }));
            this.emit({
                type: 'member_joined',
                platform: 'webchat',
                conversationId: client.conversationId,
                timestamp: new Date().toISOString(),
                data: { clientId: client.id, user: client.user },
            });
            console.log(`[WebChat] Client ${client.id} authenticated`);
        }
        else {
            this.safeSend(client.ws, JSON.stringify({
                type: 'auth_result',
                authenticated: false,
                error: 'Invalid API key',
                timestamp: new Date().toISOString(),
            }));
        }
    }
    /**
     * Handle an inbound chat message from a WebSocket client.
     */
    handleInboundChatMessage(client, msg) {
        const conversationId = msg.conversationId ?? client.conversationId;
        const timestamp = new Date().toISOString();
        // Build content blocks
        let contentBlocks;
        if (msg.blocks && msg.blocks.length > 0) {
            contentBlocks = msg.blocks;
        }
        else if (msg.text) {
            contentBlocks = [{ type: 'text', text: msg.text }];
        }
        else {
            contentBlocks = [{ type: 'text', text: '' }];
        }
        const messageId = this.generateMessageId();
        const channelMessage = {
            messageId,
            platform: 'webchat',
            conversationId,
            conversationType: 'direct',
            sender: client.user ?? {
                id: client.id,
                displayName: `User ${client.id}`,
            },
            content: contentBlocks,
            text: msg.text ??
                contentBlocks
                    .filter((b) => b.type === 'text')
                    .map((b) => b.text)
                    .join('\n'),
            timestamp,
            replyToMessageId: msg.replyToMessageId,
        };
        this.emit({
            type: 'message',
            platform: 'webchat',
            conversationId,
            timestamp,
            data: channelMessage,
        });
    }
    /**
     * Handle a client disconnection.
     */
    handleClientDisconnect(client) {
        if (!this.clients.has(client.id))
            return;
        this.clients.delete(client.id);
        if (client.authenticated) {
            this.emit({
                type: 'member_left',
                platform: 'webchat',
                conversationId: client.conversationId,
                timestamp: new Date().toISOString(),
                data: { clientId: client.id, user: client.user },
            });
        }
        console.log(`[WebChat] Client ${client.id} disconnected (${this.clients.size} remaining)`);
    }
    // ── Private: Utilities ──
    /**
     * Safely send data over a WebSocket, catching errors.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    safeSend(ws, data) {
        try {
            if (ws.readyState === 1) {
                // OPEN
                ws.send(data);
            }
        }
        catch (err) {
            console.error('[WebChat] Failed to send message:', err);
        }
    }
    generateClientId() {
        this.clientIdCounter++;
        return `wc-${Date.now()}-${this.clientIdCounter}`;
    }
    generateMessageId() {
        return `wcm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
}
//# sourceMappingURL=WebChatChannelAdapter.js.map