/**
 * @fileoverview LinkedIn OAuth 2.0 authorization code flow with PKCE.
 *
 * Supports token refresh when a refresh token is issued for the app/scopes.
 *
 * @module agentos/core/llm/auth/LinkedInOAuthFlow
 */

import {
  BrowserOAuthFlow,
  type BrowserOAuthConfig,
  type BrowserOAuthFlowOptions,
} from './BrowserOAuthFlow.js';
import type { OAuthTokenSet } from './types.js';

const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';

const DEFAULT_SCOPES = ['openid', 'profile', 'email', 'w_member_social'];

export interface LinkedInOAuthFlowOptions extends BrowserOAuthFlowOptions {
  /** LinkedIn OAuth Client ID. Falls back to LINKEDIN_CLIENT_ID env var. */
  clientId?: string;
  /** LinkedIn OAuth Client Secret. Falls back to LINKEDIN_CLIENT_SECRET env var. */
  clientSecret?: string;
  /** Override requested scopes. */
  scopes?: string[];
}

export class LinkedInOAuthFlow extends BrowserOAuthFlow {
  readonly providerId = 'linkedin';
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly scopes: string[];

  constructor(opts?: LinkedInOAuthFlowOptions) {
    super(opts);
    this.clientId = opts?.clientId ?? process.env.LINKEDIN_CLIENT_ID ?? '';
    this.clientSecret = opts?.clientSecret ?? process.env.LINKEDIN_CLIENT_SECRET ?? '';
    this.scopes = opts?.scopes ?? DEFAULT_SCOPES;

    if (!this.clientId) {
      throw new Error(
        'LinkedIn OAuth Client ID is required. Pass --client-id or set LINKEDIN_CLIENT_ID.',
      );
    }
    if (!this.clientSecret) {
      throw new Error(
        'LinkedIn OAuth Client Secret is required. Pass --client-secret or set LINKEDIN_CLIENT_SECRET.',
      );
    }
  }

  protected getConfig(): BrowserOAuthConfig {
    return {
      displayName: 'LinkedIn',
      authorizationEndpoint: LINKEDIN_AUTH_URL,
      tokenEndpoint: LINKEDIN_TOKEN_URL,
      scopes: this.scopes,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
    };
  }

  protected async exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<OAuthTokenSet> {
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

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
  }

  protected async refreshTokens(refreshToken: string): Promise<OAuthTokenSet> {
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

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
  }
}
