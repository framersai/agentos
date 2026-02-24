/**
 * @fileoverview Core types for OAuth-based LLM provider authentication.
 * @module agentos/core/llm/auth/types
 */

/** Authentication method for an LLM provider. */
export type AuthMethod = 'api-key' | 'oauth';

/** Stored OAuth token set. */
export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Unix epoch milliseconds when the access token expires. */
  expiresAt: number;
}

/** Provider-specific OAuth configuration. */
export interface OAuthProviderConfig {
  clientId: string;
  /** Endpoint to request a device code (device code flow). */
  deviceCodeEndpoint: string;
  /** Endpoint to poll for authorization completion (device code flow). */
  deviceTokenEndpoint: string;
  /** Standard OAuth token endpoint (code exchange + refresh). */
  tokenEndpoint: string;
  /** Redirect URI for the code exchange step. */
  redirectUri: string;
}

/** Persistent storage for OAuth tokens. */
export interface IOAuthTokenStore {
  load(providerId: string): Promise<OAuthTokenSet | null>;
  save(providerId: string, tokens: OAuthTokenSet): Promise<void>;
  clear(providerId: string): Promise<void>;
}

/** OAuth authentication flow for an LLM provider. */
export interface IOAuthFlow {
  readonly providerId: string;

  /** Run the interactive OAuth flow. Returns tokens on success. */
  authenticate(): Promise<OAuthTokenSet>;

  /** Refresh an expired access token using the stored refresh token. */
  refresh(tokens: OAuthTokenSet): Promise<OAuthTokenSet>;

  /** Check whether the given token set is still valid (not expired). */
  isValid(tokens: OAuthTokenSet): boolean;

  /**
   * Get a usable access token, refreshing automatically if needed.
   * Loads from store, refreshes if expired, and saves updated tokens.
   * Throws if no stored tokens exist (user must run authenticate() first).
   */
  getAccessToken(): Promise<string>;
}
