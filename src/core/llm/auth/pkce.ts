/**
 * @fileoverview PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0.
 * @module agentos/core/llm/auth/pkce
 */

import { randomBytes, createHash } from 'node:crypto';

/**
 * Generate a cryptographically random code verifier for PKCE.
 * @param length Number of random bytes (output will be base64url-encoded, up to 128 chars).
 */
export function generateCodeVerifier(length = 64): string {
  return randomBytes(length).toString('base64url').slice(0, 128);
}

/**
 * Derive a S256 code challenge from a code verifier.
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Generate a random state parameter for CSRF protection.
 */
export function generateState(): string {
  return randomBytes(32).toString('hex');
}
