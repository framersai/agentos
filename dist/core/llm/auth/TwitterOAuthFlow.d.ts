/**
 * @fileoverview Twitter/X OAuth 2.0 authorization code flow with PKCE.
 *
 * Uses Twitter API v2 OAuth 2.0 endpoints. PKCE is required (public client,
 * no client secret needed). Supports offline.access scope for refresh tokens.
 *
 * @module agentos/core/llm/auth/TwitterOAuthFlow
 */
import type { OAuthTokenSet } from './types.js';
import { BrowserOAuthFlow, type BrowserOAuthConfig, type BrowserOAuthFlowOptions } from './BrowserOAuthFlow.js';
export interface TwitterOAuthFlowOptions extends BrowserOAuthFlowOptions {
    /** Twitter OAuth 2.0 Client ID. Falls back to TWITTER_CLIENT_ID env var. */
    clientId?: string;
    /** Override scopes (default includes tweet.read/write, users.read, follows, offline.access). */
    scopes?: string[];
}
export declare class TwitterOAuthFlow extends BrowserOAuthFlow {
    readonly providerId = "twitter";
    private readonly clientId;
    private readonly scopes;
    constructor(opts?: TwitterOAuthFlowOptions);
    protected getConfig(): BrowserOAuthConfig;
    protected exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<OAuthTokenSet>;
    protected refreshTokens(refreshToken: string): Promise<OAuthTokenSet>;
}
//# sourceMappingURL=TwitterOAuthFlow.d.ts.map