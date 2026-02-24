/**
 * @fileoverview OpenAI OAuth device code flow implementation.
 *
 * Uses the same public client ID and endpoints as the Codex CLI to obtain
 * API access tokens from OpenAI consumer subscriptions (ChatGPT Plus/Pro).
 *
 * Flow:
 * 1. POST /deviceauth/usercode → { device_auth_id, user_code, interval }
 * 2. User visits verification URL and enters the code
 * 3. Poll POST /deviceauth/token → { authorization_code, code_verifier }
 * 4. Exchange POST /oauth/token with grant_type=authorization_code → { access_token, refresh_token }
 *
 * @module agentos/core/llm/auth/OpenAIOAuthFlow
 */

import type {
  IOAuthFlow,
  IOAuthTokenStore,
  OAuthTokenSet,
} from './types.js';
import { FileTokenStore } from './FileTokenStore.js';

/** OpenAI's public Codex CLI client ID. */
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

/** OpenAI auth base URL. */
const AUTH_BASE_URL = 'https://auth.openai.com';

/** Redirect URI used in the code exchange step. */
const REDIRECT_URI = 'http://localhost:1455/auth/callback';

/** Verification URL shown to the user. */
const VERIFICATION_URL = 'https://platform.openai.com/device';

/** Buffer in ms before expiry to trigger refresh (5 minutes). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Maximum time to wait for user to authorize (15 minutes). */
const MAX_POLL_DURATION_MS = 15 * 60 * 1000;

export interface OpenAIOAuthFlowOptions {
  tokenStore?: IOAuthTokenStore;
  clientId?: string;
  /** Called when the user needs to visit a URL and enter a code. */
  onUserCode?: (userCode: string, verificationUrl: string) => void;
}

export class OpenAIOAuthFlow implements IOAuthFlow {
  readonly providerId = 'openai';
  private readonly store: IOAuthTokenStore;
  private readonly clientId: string;
  private readonly onUserCode: (userCode: string, verificationUrl: string) => void;
  private refreshPromise: Promise<OAuthTokenSet> | null = null;

  constructor(opts?: OpenAIOAuthFlowOptions) {
    this.store = opts?.tokenStore ?? new FileTokenStore();
    this.clientId = opts?.clientId ?? OPENAI_CLIENT_ID;
    this.onUserCode = opts?.onUserCode ?? defaultOnUserCode;
  }

  /**
   * Run the device code OAuth flow interactively.
   * Displays a user code and waits for the user to authorize.
   */
  async authenticate(): Promise<OAuthTokenSet> {
    // Step 1: Request device code
    const deviceRes = await fetch(`${AUTH_BASE_URL}/deviceauth/usercode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.clientId }),
    });

    if (!deviceRes.ok) {
      const body = await deviceRes.text();
      throw new Error(`Failed to request device code: ${deviceRes.status} ${body}`);
    }

    const deviceData = await deviceRes.json() as {
      device_auth_id: string;
      user_code: string;
      interval: number;
    };

    const { device_auth_id, user_code, interval } = deviceData;
    const pollIntervalMs = (interval || 5) * 1000;

    // Display code to user
    this.onUserCode(user_code, VERIFICATION_URL);

    // Step 2: Poll for authorization
    const startTime = Date.now();
    let authCode: string | undefined;
    let codeVerifier: string | undefined;

    while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
      await sleep(pollIntervalMs);

      const pollRes = await fetch(`${AUTH_BASE_URL}/deviceauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_auth_id, user_code }),
      });

      if (pollRes.ok) {
        const pollData = await pollRes.json() as {
          authorization_code?: string;
          code_verifier?: string;
        };

        if (pollData.authorization_code) {
          authCode = pollData.authorization_code;
          codeVerifier = pollData.code_verifier;
          break;
        }
      }

      // 403/428 means "authorization_pending" — keep polling
      if (pollRes.status === 403 || pollRes.status === 428) {
        continue;
      }

      // Other errors are fatal
      if (!pollRes.ok) {
        const body = await pollRes.text();
        throw new Error(`Device auth poll failed: ${pollRes.status} ${body}`);
      }
    }

    if (!authCode) {
      throw new Error('OAuth authorization timed out. Please try again.');
    }

    // Step 3: Exchange authorization code for tokens
    const tokenRes = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: REDIRECT_URI,
        client_id: this.clientId,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      }).toString(),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      throw new Error(`Token exchange failed: ${tokenRes.status} ${body}`);
    }

    const tokenData = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const tokens: OAuthTokenSet = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
    };

    await this.store.save(this.providerId, tokens);
    return tokens;
  }

  /**
   * Refresh an expired access token using the refresh token.
   */
  async refresh(tokens: OAuthTokenSet): Promise<OAuthTokenSet> {
    if (!tokens.refreshToken) {
      throw new Error('No refresh token available. Please run authenticate() again.');
    }

    const res = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: this.clientId,
      }).toString(),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Token refresh failed: ${res.status} ${body}`);
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const refreshed: OAuthTokenSet = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };

    await this.store.save(this.providerId, refreshed);
    return refreshed;
  }

  /**
   * Check if the token set is still valid (not expired, with buffer).
   */
  isValid(tokens: OAuthTokenSet): boolean {
    return Date.now() < tokens.expiresAt - REFRESH_BUFFER_MS;
  }

  /**
   * Get a usable access token. Loads from store, refreshes if needed.
   * Uses a mutex to prevent concurrent refresh races.
   */
  async getAccessToken(): Promise<string> {
    const tokens = await this.store.load(this.providerId);
    if (!tokens) {
      throw new Error(
        'No OpenAI OAuth tokens found. Run `wunderland login` to authenticate with your OpenAI subscription.',
      );
    }

    if (this.isValid(tokens)) {
      return tokens.accessToken;
    }

    // Need refresh — use mutex to prevent concurrent refreshes
    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh(tokens).finally(() => {
        this.refreshPromise = null;
      });
    }

    const refreshed = await this.refreshPromise;
    return refreshed.accessToken;
  }
}

function defaultOnUserCode(userCode: string, verificationUrl: string): void {
  console.log('');
  console.log('  To authenticate, visit:');
  console.log(`    ${verificationUrl}`);
  console.log('');
  console.log(`  Enter code: ${userCode}`);
  console.log('');
  console.log('  Waiting for authorization...');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
