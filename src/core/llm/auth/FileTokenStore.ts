/**
 * @fileoverview File-based persistent token store for OAuth tokens.
 * Stores tokens at ~/.wunderland/auth/{providerId}.json with 0o600 permissions.
 * @module agentos/core/llm/auth/FileTokenStore
 */

import { mkdir, readFile, writeFile, unlink, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IOAuthTokenStore, OAuthTokenSet } from './types.js';

export class FileTokenStore implements IOAuthTokenStore {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), '.wunderland', 'auth');
  }

  private tokenPath(providerId: string): string {
    // Sanitize provider ID to prevent path traversal
    const safe = providerId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.baseDir, `${safe}.json`);
  }

  async load(providerId: string): Promise<OAuthTokenSet | null> {
    const p = this.tokenPath(providerId);
    if (!existsSync(p)) return null;
    try {
      const raw = await readFile(p, 'utf8');
      const data = JSON.parse(raw);
      if (typeof data.accessToken !== 'string' || typeof data.expiresAt !== 'number') {
        return null;
      }
      return {
        accessToken: data.accessToken,
        refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : undefined,
        expiresAt: data.expiresAt,
      };
    } catch {
      return null;
    }
  }

  async save(providerId: string, tokens: OAuthTokenSet): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    const p = this.tokenPath(providerId);
    await writeFile(p, JSON.stringify(tokens, null, 2), 'utf8');
    try {
      await chmod(p, 0o600);
    } catch {
      // chmod may fail on Windows — non-fatal
    }
  }

  async clear(providerId: string): Promise<void> {
    const p = this.tokenPath(providerId);
    if (existsSync(p)) {
      await unlink(p);
    }
  }
}
