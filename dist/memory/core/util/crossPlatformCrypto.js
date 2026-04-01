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
const _isNode = typeof process !== 'undefined' && !!process.versions?.node;
/**
 * Compute SHA-256 hex digest of a string.
 *
 * Uses Node.js `crypto.createHash` when available (fast, synchronous
 * under the hood). Falls back to `crypto.subtle.digest` in browsers.
 *
 * @param input - The string to hash.
 * @returns 64-character lowercase hex digest.
 */
export async function sha256(input) {
    if (_isNode) {
        const { createHash } = await import('node:crypto');
        return createHash('sha256').update(input, 'utf8').digest('hex');
    }
    const encoded = new TextEncoder().encode(input);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
/**
 * Generate a UUID v4 string.
 *
 * Uses `crypto.randomUUID()` which is available in Node.js 19+ and all
 * modern browsers. Falls back to a manual implementation using
 * `crypto.getRandomValues` or `Math.random`.
 *
 * @returns UUID v4 string (e.g. `"550e8400-e29b-41d4-a716-446655440000"`).
 */
export function uuid() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
        globalThis.crypto.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < 16; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
    const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
//# sourceMappingURL=crossPlatformCrypto.js.map