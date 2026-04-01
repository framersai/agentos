/**
 * @fileoverview PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0.
 * @module agentos/core/llm/auth/pkce
 */
/**
 * Generate a cryptographically random code verifier for PKCE.
 * @param length Number of random bytes (output will be base64url-encoded, up to 128 chars).
 */
export declare function generateCodeVerifier(length?: number): string;
/**
 * Derive a S256 code challenge from a code verifier.
 */
export declare function generateCodeChallenge(verifier: string): string;
/**
 * Generate a random state parameter for CSRF protection.
 */
export declare function generateState(): string;
//# sourceMappingURL=pkce.d.ts.map