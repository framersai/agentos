import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const DEFAULT_TEMPLATE = `# Working Memory

## User Profile
- **Name**:
- **Preferences**:

## Current Context
- **Active Topics**:
- **Recent Requests**:

## Notes
`;
/**
 * Persistent markdown working memory backed by a .md file on disk.
 * The agent reads and fully replaces this file via tools.
 * File contents are injected into the system prompt every turn.
 */
export class MarkdownWorkingMemory {
    constructor(filePath, template = DEFAULT_TEMPLATE, maxTokens = 2000) {
        this.filePath = filePath;
        this.template = template;
        this.maxTokens = maxTokens;
    }
    /** Creates the file with the template if it doesn't exist. */
    ensureFile() {
        if (existsSync(this.filePath))
            return;
        const dir = dirname(this.filePath);
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        writeFileSync(this.filePath, this.template, 'utf8');
    }
    /** Reads current file contents. Returns empty string if file missing. */
    read() {
        if (!existsSync(this.filePath))
            return '';
        try {
            return readFileSync(this.filePath, 'utf8');
        }
        catch {
            return '';
        }
    }
    /** Replaces file contents entirely. Truncates if over maxTokens. */
    write(content) {
        const tokens = this.estimateTokenCount(content);
        let truncated = false;
        if (tokens > this.maxTokens) {
            const maxChars = this.maxTokens * 4;
            content = content.slice(0, maxChars) + '\n\n<!-- truncated: exceeded token limit -->';
            truncated = true;
        }
        try {
            const dir = dirname(this.filePath);
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            writeFileSync(this.filePath, content, 'utf8');
            return { success: true, truncated, tokensUsed: this.estimateTokenCount(content) };
        }
        catch (err) {
            return { success: false, truncated: false, tokensUsed: 0, error: err?.message };
        }
    }
    /** Estimates token count (~4 chars per token). */
    estimateTokens() {
        return this.estimateTokenCount(this.read());
    }
    estimateTokenCount(text) {
        if (!text)
            return 0;
        return Math.ceil(text.length / 4);
    }
    /** Returns the file path for reference. */
    getFilePath() {
        return this.filePath;
    }
}
//# sourceMappingURL=MarkdownWorkingMemory.js.map