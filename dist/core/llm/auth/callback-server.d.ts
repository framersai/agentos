/**
 * @fileoverview Ephemeral localhost HTTP server for OAuth 2.0 authorization code callbacks.
 *
 * Listens on an OS-assigned port, waits for a single GET /callback with
 * code + state query params, validates the state, and resolves.
 *
 * @module agentos/core/llm/auth/callback-server
 */
export interface CallbackResult {
    code: string;
    state: string;
}
export interface CallbackServerOptions {
    /** Expected state value for CSRF validation. */
    expectedState: string;
    /** Maximum time (ms) to wait for the callback before timing out. */
    timeoutMs: number;
    /** Called once the server is listening, with the assigned port. */
    onListening?: (port: number) => void;
}
/**
 * Start an ephemeral localhost HTTP server to receive the OAuth callback.
 *
 * @returns An object with:
 *  - `promise` — resolves with `{ code, state }` on success, rejects on timeout/error
 *  - `shutdown()` — forcibly close the server
 */
export declare function startCallbackServer(opts: CallbackServerOptions): {
    promise: Promise<CallbackResult>;
    shutdown: () => void;
};
//# sourceMappingURL=callback-server.d.ts.map