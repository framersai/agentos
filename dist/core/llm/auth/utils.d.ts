/**
 * @fileoverview Shared OAuth utilities.
 * @module agentos/core/llm/auth/utils
 */
import type { OAuthTokenSet } from './types.js';
/**
 * Check whether an OAuth token set is still valid (not expired, with buffer).
 * Provider-agnostic — works with any OAuthTokenSet.
 */
export declare function isTokenValid(tokens: OAuthTokenSet, bufferMs?: number): boolean;
/**
 * Attempt to open a URL in the user's default browser.
 * Returns true if the command was launched, false on failure (e.g., headless environment).
 */
export declare function openBrowser(url: string): Promise<boolean>;
//# sourceMappingURL=utils.d.ts.map