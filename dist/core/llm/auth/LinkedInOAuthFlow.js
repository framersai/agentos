/**
 * @fileoverview LinkedIn OAuth 2.0 authorization code flow with PKCE.
 *
 * Supports token refresh when a refresh token is issued for the app/scopes.
 *
 * @module agentos/core/llm/auth/LinkedInOAuthFlow
 */
import { BrowserOAuthFlow, } from './BrowserOAuthFlow.js';
const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const DEFAULT_SCOPES = ['openid', 'profile', 'email', 'w_member_social'];
export class LinkedInOAuthFlow extends BrowserOAuthFlow {
    constructor(opts) {
        super(opts);
        this.providerId = 'linkedin';
        this.clientId = opts?.clientId ?? process.env.LINKEDIN_CLIENT_ID ?? '';
        this.clientSecret = opts?.clientSecret ?? process.env.LINKEDIN_CLIENT_SECRET ?? '';
        this.scopes = opts?.scopes ?? DEFAULT_SCOPES;
        if (!this.clientId) {
            throw new Error('LinkedIn OAuth Client ID is required. Pass --client-id or set LINKEDIN_CLIENT_ID.');
        }
        if (!this.clientSecret) {
            throw new Error('LinkedIn OAuth Client Secret is required. Pass --client-secret or set LINKEDIN_CLIENT_SECRET.');
        }
    }
    getConfig() {
        return {
            displayName: 'LinkedIn',
            authorizationEndpoint: LINKEDIN_AUTH_URL,
            tokenEndpoint: LINKEDIN_TOKEN_URL,
            scopes: this.scopes,
            clientId: this.clientId,
            clientSecret: this.clientSecret,
        };
    }
    async exchangeCode(code, redirectUri, codeVerifier) {
        const res = await fetch(LINKEDIN_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
                client_id: this.clientId,
                client_secret: this.clientSecret,
                code_verifier: codeVerifier,
            }).toString(),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`LinkedIn token exchange failed: ${res.status} ${body}`);
        }
        const data = (await res.json());
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
        };
    }
    async refreshTokens(refreshToken) {
        const res = await fetch(LINKEDIN_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: this.clientId,
                client_secret: this.clientSecret,
            }).toString(),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`LinkedIn token refresh failed: ${res.status} ${body}`);
        }
        const data = (await res.json());
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
        };
    }
}
//# sourceMappingURL=LinkedInOAuthFlow.js.map