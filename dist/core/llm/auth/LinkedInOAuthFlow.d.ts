/**
 * @fileoverview LinkedIn OAuth 2.0 authorization code flow with PKCE.
 *
 * Supports token refresh when a refresh token is issued for the app/scopes.
 *
 * @module agentos/core/llm/auth/LinkedInOAuthFlow
 */
import { BrowserOAuthFlow, type BrowserOAuthConfig, type BrowserOAuthFlowOptions } from './BrowserOAuthFlow.js';
import type { OAuthTokenSet } from './types.js';
export interface LinkedInOAuthFlowOptions extends BrowserOAuthFlowOptions {
    /** LinkedIn OAuth Client ID. Falls back to LINKEDIN_CLIENT_ID env var. */
    clientId?: string;
    /** LinkedIn OAuth Client Secret. Falls back to LINKEDIN_CLIENT_SECRET env var. */
    clientSecret?: string;
    /** Override requested scopes. */
    scopes?: string[];
}
export declare class LinkedInOAuthFlow extends BrowserOAuthFlow {
    readonly providerId = "linkedin";
    private readonly clientId;
    private readonly clientSecret;
    private readonly scopes;
    constructor(opts?: LinkedInOAuthFlowOptions);
    protected getConfig(): BrowserOAuthConfig;
    protected exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<OAuthTokenSet>;
    protected refreshTokens(refreshToken: string): Promise<OAuthTokenSet>;
}
//# sourceMappingURL=LinkedInOAuthFlow.d.ts.map