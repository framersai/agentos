/**
 * @fileoverview OpenAI OAuth PKCE flow — browser-based, like the Codex CLI.
 *
 * Uses the same public client ID and endpoints as the Codex CLI to obtain
 * API access tokens from OpenAI consumer subscriptions (ChatGPT Plus/Pro).
 *
 * Flow (browser-based PKCE — bypasses Cloudflare challenges):
 * 1. Generate PKCE code_verifier + code_challenge
 * 2. Start a local HTTP server on localhost:1455
 * 3. Open the user's browser to OpenAI's /authorize endpoint
 * 4. User logs in via browser → OpenAI redirects to localhost:1455/auth/callback
 * 5. Exchange authorization_code + code_verifier for tokens via /oauth/token
 *
 * @module agentos/core/llm/auth/OpenAIOAuthFlow
 */
import type { IOAuthFlow, IOAuthTokenStore, OAuthTokenSet } from './types.js';
export interface OpenAIOAuthFlowOptions {
    tokenStore?: IOAuthTokenStore;
    clientId?: string;
    /** Called when the browser is about to open. */
    onBrowserOpen?: (authUrl: string) => void;
}
export declare class OpenAIOAuthFlow implements IOAuthFlow {
    readonly providerId = "openai";
    private readonly store;
    private readonly clientId;
    private readonly onBrowserOpen;
    private refreshPromise;
    constructor(opts?: OpenAIOAuthFlowOptions);
    /**
     * Run the browser-based PKCE OAuth flow.
     * Opens the user's browser, waits for the callback, exchanges for tokens.
     */
    authenticate(): Promise<OAuthTokenSet>;
    /**
     * Exchange an id_token for an OpenAI API key.
     * This mirrors Codex CLI's `obtain_api_key()` step.
     */
    private obtainApiKey;
    /**
     * Refresh an expired access token using the refresh token.
     */
    refresh(tokens: OAuthTokenSet): Promise<OAuthTokenSet>;
    /**
     * Check if the token set is still valid (not expired, with buffer).
     */
    isValid(tokens: OAuthTokenSet): boolean;
    /**
     * Get a usable access token. Loads from store, refreshes if needed.
     * Uses a mutex to prevent concurrent refresh races.
     */
    getAccessToken(): Promise<string>;
}
//# sourceMappingURL=OpenAIOAuthFlow.d.ts.map