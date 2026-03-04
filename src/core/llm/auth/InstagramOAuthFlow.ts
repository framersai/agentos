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

import type { IOAuthTokenStore, OAuthTokenSet } from './types.js';
import { BrowserOAuthFlow, type BrowserOAuthConfig, type BrowserOAuthFlowOptions } from './BrowserOAuthFlow.js';

const META_AUTH_URL = 'https://www.facebook.com/v21.0/dialog/oauth';
const META_TOKEN_URL = 'https://graph.facebook.com/v21.0/oauth/access_token';
const GRAPH_API = 'https://graph.facebook.com/v21.0';

const DEFAULT_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_insights',
  'pages_read_engagement',
  'pages_show_list',
];

export interface InstagramOAuthFlowOptions extends BrowserOAuthFlowOptions {
  /** Meta/Facebook App ID. Falls back to META_APP_ID or FACEBOOK_APP_ID env var. */
  appId?: string;
  /** Meta/Facebook App Secret. Falls back to META_APP_SECRET or FACEBOOK_APP_SECRET env var. */
  appSecret?: string;
  /** Override scopes. */
  scopes?: string[];
}

export class InstagramOAuthFlow extends BrowserOAuthFlow {
  readonly providerId = 'instagram';
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly scopes: string[];

  constructor(opts?: InstagramOAuthFlowOptions) {
    super(opts);
    this.appId = opts?.appId ?? process.env.META_APP_ID ?? process.env.FACEBOOK_APP_ID ?? '';
    this.appSecret = opts?.appSecret ?? process.env.META_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET ?? '';
    this.scopes = opts?.scopes ?? DEFAULT_SCOPES;

    if (!this.appId) {
      throw new Error(
        'Meta/Facebook App ID is required for Instagram OAuth. '
        + 'Pass it via --app-id flag, set META_APP_ID env var, '
        + 'or create an app at https://developers.facebook.com/apps/',
      );
    }
    if (!this.appSecret) {
      throw new Error(
        'Meta/Facebook App Secret is required for Instagram OAuth. '
        + 'Pass it via --app-secret flag or set META_APP_SECRET env var.',
      );
    }
  }

  protected getConfig(): BrowserOAuthConfig {
    return {
      displayName: 'Instagram',
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
    // Meta uses query params (not POST body) for the token exchange
    const params = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: redirectUri,
      code,
    });

    const res = await fetch(`${META_TOKEN_URL}?${params.toString()}`);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Instagram token exchange failed: ${res.status} ${body}`);
    }

    const data = await res.json() as {
      access_token: string;
      token_type: string;
      expires_in?: number;
    };

    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
  }

  /**
   * Exchange short-lived token for long-lived token (60 days),
   * then resolve the IG Business Account ID.
   */
  protected override async postExchange(tokens: OAuthTokenSet): Promise<OAuthTokenSet> {
    // 1. Exchange for long-lived token
    const llParams = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: tokens.accessToken,
    });

    const llRes = await fetch(`${META_TOKEN_URL}?${llParams.toString()}`);
    if (llRes.ok) {
      const llData = await llRes.json() as {
        access_token: string;
        token_type: string;
        expires_in?: number;
      };
      tokens = {
        accessToken: llData.access_token,
        // Long-lived tokens don't have traditional refresh tokens;
        // they're refreshed by calling the same endpoint before expiry
        refreshToken: llData.access_token,
        expiresAt: Date.now() + (llData.expires_in ?? 5184000) * 1000, // ~60 days
      };
    }

    // 2. Resolve IG Business Account ID
    const igUserId = await this.resolveIgUserId(tokens.accessToken);
    if (igUserId) {
      tokens.metadata = { ...tokens.metadata, igUserId };
    }

    return tokens;
  }

  protected async refreshTokens(refreshToken: string): Promise<OAuthTokenSet> {
    // For Meta long-lived tokens, "refresh" means exchanging the current
    // long-lived token for a new one (must be done before expiry)
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: refreshToken,
    });

    const res = await fetch(`${META_TOKEN_URL}?${params.toString()}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Instagram token refresh failed: ${res.status} ${body}`);
    }

    const data = await res.json() as {
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

  /**
   * Resolve the Instagram Business Account ID from the user's Facebook pages.
   */
  private async resolveIgUserId(accessToken: string): Promise<string | undefined> {
    try {
      // Get user's pages
      const pagesRes = await fetch(
        `${GRAPH_API}/me/accounts?fields=id,name,instagram_business_account&access_token=${accessToken}`,
      );
      if (!pagesRes.ok) return undefined;

      const pagesData = await pagesRes.json() as {
        data: Array<{
          id: string;
          name: string;
          instagram_business_account?: { id: string };
        }>;
      };

      // Find first page with an Instagram business account
      for (const page of pagesData.data) {
        if (page.instagram_business_account?.id) {
          return page.instagram_business_account.id;
        }
      }

      return undefined;
    } catch {
      return undefined;
    }
  }
}
