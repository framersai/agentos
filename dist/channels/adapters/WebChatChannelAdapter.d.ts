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
import type { ChannelAuthConfig, ChannelCapability, ChannelPlatform, ChannelSendResult, MessageContent } from '../types.js';
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
/** Platform-specific parameters for WebChat connections. */
export interface WebChatAuthParams extends Record<string, string | undefined> {
    /** API key for authenticating WebSocket clients. Optional. */
    apiKey?: string;
    /** Comma-separated CORS origins (default: '*'). */
    corsOrigins?: string;
    /** Port for standalone HTTP server (default: '8080'). Ignored in attached mode. */
    port?: string;
    /** Path prefix for the WebSocket endpoint (default: '/ws'). */
    wsPath?: string;
}
/**
 * Channel adapter for web-based chat using HTTP/WebSocket.
 *
 * Uses dynamic import for the `ws` package so it is only required
 * at runtime when the adapter is actually initialized.
 *
 * Capabilities: text, rich_text, images, buttons, typing_indicator,
 * read_receipts.
 */
export declare class WebChatChannelAdapter extends BaseChannelAdapter<WebChatAuthParams> {
    readonly platform: ChannelPlatform;
    readonly displayName = "WebChat";
    readonly capabilities: readonly ChannelCapability[];
    /** Node.js HTTP server (standalone mode). */
    private httpServer;
    /** WebSocket server (ws package). */
    private wss;
    /** Connected clients, keyed by client ID. */
    private clients;
    /** External HTTP server (attached mode). */
    private externalServer;
    /** Whether we created the HTTP server ourselves (vs attached). */
    private ownServer;
    /** API key for client authentication. Empty string means no auth required. */
    private apiKey;
    /** Allowed CORS origins. */
    private corsOrigins;
    /** Counter for generating client IDs. */
    private clientIdCounter;
    /**
     * Attach to an existing HTTP server instead of creating a standalone one.
     * Must be called before {@link initialize}.
     *
     * @param server - Node.js http.Server instance (e.g., from Express).
     */
    attachToServer(server: any): void;
    protected doConnect(auth: ChannelAuthConfig & {
        params?: WebChatAuthParams;
    }): Promise<void>;
    protected doSendMessage(conversationId: string, content: MessageContent): Promise<ChannelSendResult>;
    protected doShutdown(): Promise<void>;
    sendTypingIndicator(conversationId: string, isTyping: boolean): Promise<void>;
    getConversationInfo(conversationId: string): Promise<{
        name?: string;
        memberCount?: number;
        isGroup: boolean;
        metadata?: Record<string, unknown>;
    }>;
    /** Get the number of currently connected clients. */
    getConnectedClientCount(): number;
    /** Get all connected client IDs. */
    getConnectedClientIds(): string[];
    /**
     * Broadcast a message to ALL connected and authenticated clients.
     */
    broadcast(content: MessageContent): Promise<void>;
    /**
     * Handle plain HTTP requests (standalone mode only).
     * Provides a simple health-check endpoint and CORS headers.
     */
    private handleHttpRequest;
    /**
     * Handle a new WebSocket connection.
     */
    private handleNewConnection;
    /**
     * Handle a message from a connected WebSocket client.
     */
    private handleClientMessage;
    /**
     * Handle client authentication.
     */
    private handleAuth;
    /**
     * Handle an inbound chat message from a WebSocket client.
     */
    private handleInboundChatMessage;
    /**
     * Handle a client disconnection.
     */
    private handleClientDisconnect;
    /**
     * Safely send data over a WebSocket, catching errors.
     */
    private safeSend;
    private generateClientId;
    private generateMessageId;
}
//# sourceMappingURL=WebChatChannelAdapter.d.ts.map