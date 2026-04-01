/**
 * @fileoverview Instagram/Meta OAuth 2.0 authorization code flow.
 *
 * Uses Facebook's OAuth 2.0 to obtain an Instagram Graph API access token.
 * After the initial code exchange, the short-lived token is swapped for a
 * long-lived token (60 days). The IG Business Account ID is resolved and
 * stored in token metadata.
 *
 * @module agentos/core/llm/auth/InstagramOAuthFlow
 */
import type { OAuthTokenSet } from './types.js';
import { BrowserOAuthFlow, type BrowserOAuthConfig, type BrowserOAuthFlowOptions } from './BrowserOAuthFlow.js';
export interface InstagramOAuthFlowOptions extends BrowserOAuthFlowOptions {
    /** Meta/Facebook App ID. Falls back to META_APP_ID or FACEBOOK_APP_ID env var. */
    appId?: string;
    /** Meta/Facebook App Secret. Falls back to META_APP_SECRET or FACEBOOK_APP_SECRET env var. */
    appSecret?: string;
    /** Override scopes. */
    scopes?: string[];
}
export declare class InstagramOAuthFlow extends BrowserOAuthFlow {
    readonly providerId = "instagram";
    private readonly appId;
    private readonly appSecret;
    private readonly scopes;
    constructor(opts?: InstagramOAuthFlowOptions);
    protected getConfig(): BrowserOAuthConfig;
    protected exchangeCode(code: string, redirectUri: string, _codeVerifier: string): Promise<OAuthTokenSet>;
    /**
     * Exchange short-lived token for long-lived token (60 days),
     * then resolve the IG Business Account ID.
     */
    protected postExchange(tokens: OAuthTokenSet): Promise<OAuthTokenSet>;
    protected refreshTokens(refreshToken: string): Promise<OAuthTokenSet>;
    /**
     * Resolve the Instagram Business Account ID from the user's Facebook pages.
     */
    private resolveIgUserId;
}
//# sourceMappingURL=InstagramOAuthFlow.d.ts.map