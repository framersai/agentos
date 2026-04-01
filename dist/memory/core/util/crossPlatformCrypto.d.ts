/**
 * @fileoverview Cross-platform cryptographic utilities.
 *
 * Provides SHA-256 hashing and UUID v4 generation that work in both
 * Node.js and browser environments. Node.js uses the native `crypto`
 * module for performance; browsers use `crypto.subtle` and
 * `crypto.getRandomValues`.
 *
 * @module memory/util/crossPlatformCrypto
 */
/**
 * Compute SHA-256 hex digest of a string.
 *
 * Uses Node.js `crypto.createHash` when available (fast, synchronous
 * under the hood). Falls back to `crypto.subtle.digest` in browsers.
 *
 * @param input - The string to hash.
 * @returns 64-character lowercase hex digest.
 */
export declare function sha256(input: string): Promise<string>;
/**
 * Generate a UUID v4 string.
 *
 * Uses `crypto.randomUUID()` which is available in Node.js 19+ and all
 * modern browsers. Falls back to a manual implementation using
 * `crypto.getRandomValues` or `Math.random`.
 *
 * @returns UUID v4 string (e.g. `"550e8400-e29b-41d4-a716-446655440000"`).
 */
export declare function uuid(): string;
//# sourceMappingURL=crossPlatformCrypto.d.ts.map