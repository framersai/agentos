/**
 * @fileoverview Facebook/Meta OAuth 2.0 authorization code flow.
 *
 * Exchanges short-lived user tokens for long-lived tokens and stores page
 * metadata when available to simplify page-posting setup.
 *
 * @module agentos/core/llm/auth/FacebookOAuthFlow
 */

import {
  BrowserOAuthFlow,
  type BrowserOAuthConfig,
  type BrowserOAuthFlowOptions,
} from './BrowserOAuthFlow.js';
import type { OAuthTokenSet } from './types.js';

const META_AUTH_URL = 'https://www.facebook.com/v21.0/dialog/oauth';
const META_TOKEN_URL = 'https://graph.facebook.com/v21.0/oauth/access_token';
const GRAPH_API = 'https://graph.facebook.com/v21.0';

const DEFAULT_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'public_profile',
  'email',
];

export interface FacebookOAuthFlowOptions extends BrowserOAuthFlowOptions {
  /** Meta/Facebook App ID. Falls back to META_APP_ID or FACEBOOK_APP_ID. */
  appId?: string;
  /** Meta/Facebook App Secret. Falls back to META_APP_SECRET or FACEBOOK_APP_SECRET. */
  appSecret?: string;
  /** Override requested scopes. */
  scopes?: string[];
}

export class FacebookOAuthFlow extends BrowserOAuthFlow {
  readonly providerId = 'facebook';
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly scopes: string[];

  constructor(opts?: FacebookOAuthFlowOptions) {
    super(opts);
    this.appId = opts?.appId ?? process.env.META_APP_ID ?? process.env.FACEBOOK_APP_ID ?? '';
    this.appSecret =
      opts?.appSecret ?? process.env.META_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET ?? '';
    this.scopes = opts?.scopes ?? DEFAULT_SCOPES;

    if (!this.appId) {
      throw new Error(
        'Meta/Facebook App ID is required. Pass --app-id or set META_APP_ID.',
      );
    }
    if (!this.appSecret) {
      throw new Error(
        'Meta/Facebook App Secret is required. Pass --app-secret or set META_APP_SECRET.',
      );
    }
  }

  protected getConfig(): BrowserOAuthConfig {
    return {
      displayName: 'Facebook',
      authorizationEndpoint: META_AUTH_URL,
      tokenEndpoint: META_TOKEN_URL,
      scopes: this.scopes,
      clientId: this.appId,
      clientSecret: this.appSecret,
    };
  }

  protected async exchangeCode(
    code: string,
    redirectUri: string,
    _codeVerifier: string,
  ): Promise<OAuthTokenSet> {
    const params = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: redirectUri,
      code,
    });

    const res = await fetch(`${META_TOKEN_URL}?${params.toString()}`);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Facebook token exchange failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      token_type: string;
      expires_in?: number;
    };

    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
  }

  protected override async postExchange(tokens: OAuthTokenSet): Promise<OAuthTokenSet> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: tokens.accessToken,
    });

    const res = await fetch(`${META_TOKEN_URL}?${params.toString()}`);
    if (res.ok) {
      const data = (await res.json()) as {
        access_token: string;
        token_type: string;
        expires_in?: number;
      };
      tokens = {
        accessToken: data.access_token,
        refreshToken: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 5184000) * 1000,
      };
    }

    const page = await this.resolvePrimaryPage(tokens.accessToken);
    if (page) {
      tokens.metadata = {
        ...tokens.metadata,
        pageId: page.id,
        pageName: page.name,
      };
    }

    return tokens;
  }

  protected async refreshTokens(refreshToken: string): Promise<OAuthTokenSet> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: refreshToken,
    });

    const res = await fetch(`${META_TOKEN_URL}?${params.toString()}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Facebook token refresh failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      token_type: string;
      expires_in?: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 5184000) * 1000,
    };
  }

  private async resolvePrimaryPage(
    accessToken: string,
  ): Promise<{ id: string; name: string } | undefined> {
    try {
      const res = await fetch(
        `${GRAPH_API}/me/accounts?fields=id,name&access_token=${encodeURIComponent(accessToken)}`,
      );
      if (!res.ok) return undefined;
      const data = (await res.json()) as {
        data?: Array<{ id: string; name: string }>;
      };
      if (!Array.isArray(data.data) || data.data.length === 0) return undefined;
      return data.data[0];
    } catch {
      return undefined;
    }
  }
}
