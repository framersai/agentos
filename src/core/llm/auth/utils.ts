/**
 * @fileoverview Shared OAuth utilities.
 * @module agentos/core/llm/auth/utils
 */

import { exec } from 'node:child_process';
import { platform } from 'node:os';
import type { OAuthTokenSet } from './types.js';

/** Default buffer in ms before expiry to consider token invalid (5 minutes). */
const DEFAULT_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Check whether an OAuth token set is still valid (not expired, with buffer).
 * Provider-agnostic — works with any OAuthTokenSet.
 */
export function isTokenValid(tokens: OAuthTokenSet, bufferMs = DEFAULT_REFRESH_BUFFER_MS): boolean {
  return Date.now() < tokens.expiresAt - bufferMs;
}

/**
 * Attempt to open a URL in the user's default browser.
 * Returns true if the command was launched, false on failure (e.g., headless environment).
 */
export function openBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const os = platform();
    let cmd: string;

    if (os === 'darwin') {
      cmd = `open "${url}"`;
    } else if (os === 'win32') {
      cmd = `start "" "${url}"`;
    } else {
      cmd = `xdg-open "${url}"`;
    }

    exec(cmd, { timeout: 5000 }, (err) => {
      resolve(!err);
    });
  });
}
