export interface WriteResult {
    success: boolean;
    truncated: boolean;
    tokensUsed: number;
    error?: string;
}
/**
 * Persistent markdown working memory backed by a .md file on disk.
 * The agent reads and fully replaces this file via tools.
 * File contents are injected into the system prompt every turn.
 */
export declare class MarkdownWorkingMemory {
    private readonly filePath;
    private readonly template;
    private readonly maxTokens;
    constructor(filePath: string, template?: string, maxTokens?: number);
    /** Creates the file with the template if it doesn't exist. */
    ensureFile(): void;
    /** Reads current file contents. Returns empty string if file missing. */
    read(): string;
    /** Replaces file contents entirely. Truncates if over maxTokens. */
    write(content: string): WriteResult;
    /** Estimates token count (~4 chars per token). */
    estimateTokens(): number;
    private estimateTokenCount;
    /** Returns the file path for reference. */
    getFilePath(): string;
}
//# sourceMappingURL=MarkdownWorkingMemory.d.ts.map