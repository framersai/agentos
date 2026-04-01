/**
 * @fileoverview File-based persistent token store for OAuth tokens.
 * Stores tokens at ~/.wunderland/auth/{providerId}.json with 0o600 permissions.
 * @module agentos/core/llm/auth/FileTokenStore
 */
import type { IOAuthTokenStore, OAuthTokenSet } from './types.js';
export declare class FileTokenStore implements IOAuthTokenStore {
    private readonly baseDir;
    constructor(baseDir?: string);
    private tokenPath;
    load(providerId: string): Promise<OAuthTokenSet | null>;
    save(providerId: string, tokens: OAuthTokenSet): Promise<void>;
    clear(providerId: string): Promise<void>;
}
//# sourceMappingURL=FileTokenStore.d.ts.map