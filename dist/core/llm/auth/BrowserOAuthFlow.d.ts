/**
 * @fileoverview Abstract base class for browser-based OAuth 2.0 authorization code
 * flows with PKCE support.
 *
 * Orchestrates: localhost callback server → browser open → code exchange → token storage.
 * Subclasses implement provider-specific URL building, code exchange, and token refresh.
 *
 * @module agentos/core/llm/auth/BrowserOAuthFlow
 */
import type { IOAuthFlow, IOAuthTokenStore, OAuthTokenSet } from './types.js';
export interface BrowserOAuthConfig {
    /** Human-readable provider name for CLI output. */
    displayName: string;
    /** OAuth authorization endpoint URL. */
    authorizationEndpoint: string;
    /** OAuth token endpoint URL. */
    tokenEndpoint: string;
    /** Requested OAuth scopes. */
    scopes: string[];
    /** OAuth client ID. */
    clientId: string;
    /** OAuth client secret (optional — PKCE flows may not need it). */
    clientSecret?: string;
    /** Maximum time to wait for user authorization (ms). */
    timeoutMs?: number;
    /** Buffer before expiry to trigger auto-refresh (ms). */
    refreshBufferMs?: number;
}
export interface BrowserOAuthFlowOptions {
    tokenStore?: IOAuthTokenStore;
    /** Called with the authorization URL (for custom display). */
    onAuthUrl?: (url: string) => void;
}
export declare abstract class BrowserOAuthFlow implements IOAuthFlow {
    abstract readonly providerId: string;
    protected readonly store: IOAuthTokenStore;
    protected readonly onAuthUrl?: (url: string) => void;
    private refreshPromise;
    constructor(opts?: BrowserOAuthFlowOptions);
    /** Return provider-specific OAuth configuration. */
    protected abstract getConfig(): BrowserOAuthConfig;
    /**
     * Exchange an authorization code for tokens.
     * Called after the callback server receives the code.
     */
    protected abstract exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<OAuthTokenSet>;
    /**
     * Refresh an expired access token using the refresh token.
     */
    protected abstract refreshTokens(refreshToken: string): Promise<OAuthTokenSet>;
    /**
     * Post-exchange hook for provider-specific processing.
     * E.g., Instagram exchanges short-lived for long-lived tokens here.
     * Default: passthrough.
     */
    protected postExchange(tokens: OAuthTokenSet): Promise<OAuthTokenSet>;
    authenticate(): Promise<OAuthTokenSet>;
    refresh(tokens: OAuthTokenSet): Promise<OAuthTokenSet>;
    isValid(tokens: OAuthTokenSet): boolean;
    getAccessToken(): Promise<string>;
}
//# sourceMappingURL=BrowserOAuthFlow.d.ts.map