/**
 * @fileoverview Twitter/X OAuth 2.0 authorization code flow with PKCE.
 *
 * Uses Twitter API v2 OAuth 2.0 endpoints. PKCE is required (public client,
 * no client secret needed). Supports offline.access scope for refresh tokens.
 *
 * @module agentos/core/llm/auth/TwitterOAuthFlow
 */

import type { IOAuthTokenStore, OAuthTokenSet } from './types.js';
import { BrowserOAuthFlow, type BrowserOAuthConfig, type BrowserOAuthFlowOptions } from './BrowserOAuthFlow.js';

const TWITTER_AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
const TWITTER_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';

const DEFAULT_SCOPES = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'follows.read',
  'follows.write',
  'offline.access',
];

export interface TwitterOAuthFlowOptions extends BrowserOAuthFlowOptions {
  /** Twitter OAuth 2.0 Client ID. Falls back to TWITTER_CLIENT_ID env var. */
  clientId?: string;
  /** Override scopes (default includes tweet.read/write, users.read, follows, offline.access). */
  scopes?: string[];
}

export class TwitterOAuthFlow extends BrowserOAuthFlow {
  readonly providerId = 'twitter';
  private readonly clientId: string;
  private readonly scopes: string[];

  constructor(opts?: TwitterOAuthFlowOptions) {
    super(opts);
    this.clientId = opts?.clientId ?? process.env.TWITTER_CLIENT_ID ?? '';
    this.scopes = opts?.scopes ?? DEFAULT_SCOPES;

    if (!this.clientId) {
      throw new Error(
        'Twitter OAuth 2.0 Client ID is required. '
        + 'Pass it via --client-id flag, set TWITTER_CLIENT_ID env var, '
        + 'or create one at https://developer.x.com/en/portal/dashboard',
      );
    }
  }

  protected getConfig(): BrowserOAuthConfig {
    return {
      displayName: 'Twitter/X',
      authorizationEndpoint: TWITTER_AUTH_URL,
      tokenEndpoint: TWITTER_TOKEN_URL,
      scopes: this.scopes,
      clientId: this.clientId,
    };
  }

  protected async exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<OAuthTokenSet> {
    const res = await fetch(TWITTER_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: this.clientId,
        code_verifier: codeVerifier,
      }).toString(),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Twitter token exchange failed: ${res.status} ${body}`);
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
    };
  }

  protected async refreshTokens(refreshToken: string): Promise<OAuthTokenSet> {
    const res = await fetch(TWITTER_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.clientId,
      }).toString(),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Twitter token refresh failed: ${res.status} ${body}`);
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
    };
  }
}
