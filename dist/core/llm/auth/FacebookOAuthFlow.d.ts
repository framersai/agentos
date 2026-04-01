/**
 * @fileoverview Facebook/Meta OAuth 2.0 authorization code flow.
 *
 * Exchanges short-lived user tokens for long-lived tokens and stores page
 * metadata when available to simplify page-posting setup.
 *
 * @module agentos/core/llm/auth/FacebookOAuthFlow
 */
import { BrowserOAuthFlow, type BrowserOAuthConfig, type BrowserOAuthFlowOptions } from './BrowserOAuthFlow.js';
import type { OAuthTokenSet } from './types.js';
export interface FacebookOAuthFlowOptions extends BrowserOAuthFlowOptions {
    /** Meta/Facebook App ID. Falls back to META_APP_ID or FACEBOOK_APP_ID. */
    appId?: string;
    /** Meta/Facebook App Secret. Falls back to META_APP_SECRET or FACEBOOK_APP_SECRET. */
    appSecret?: string;
    /** Override requested scopes. */
    scopes?: string[];
}
export declare class FacebookOAuthFlow extends BrowserOAuthFlow {
    readonly providerId = "facebook";
    private readonly appId;
    private readonly appSecret;
    private readonly scopes;
    constructor(opts?: FacebookOAuthFlowOptions);
    protected getConfig(): BrowserOAuthConfig;
    protected exchangeCode(code: string, redirectUri: string, _codeVerifier: string): Promise<OAuthTokenSet>;
    protected postExchange(tokens: OAuthTokenSet): Promise<OAuthTokenSet>;
    protected refreshTokens(refreshToken: string): Promise<OAuthTokenSet>;
    private resolvePrimaryPage;
}
//# sourceMappingURL=FacebookOAuthFlow.d.ts.map