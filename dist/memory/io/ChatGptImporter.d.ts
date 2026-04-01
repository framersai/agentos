/**
 * @fileoverview ChatGPT export importer for AgentOS memory brain.
 *
 * Parses the `conversations.json` file produced by ChatGPT's "Export data"
 * feature and imports each conversation into the target `SqliteBrain`.
 *
 * ## Import strategy
 *
 * For each conversation object in `conversations.json`:
 * 1. A row is inserted into the `conversations` table (deduped by title + created_at).
 * 2. Every user/assistant message pair is encoded as an **episodic memory trace**
 *    whose content is `"[user]: {user_text}\n[assistant]: {assistant_text}"`.
 *    This preserves conversational context in a single retrievable unit.
 * 3. System messages and tool messages are skipped (they are not episodic memories).
 *
 * ## ChatGPT export format
 * ```json
 * [
 *   {
 *     "title": "Conversation title",
 *     "create_time": 1711234567.89,
 *     "mapping": {
 *       "node-id": {
 *         "message": {
 *           "author": { "role": "user" },
 *           "content": { "parts": ["Hello!"] }
 *         },
 *         "children": ["next-node-id"]
 *       }
 *     }
 *   }
 * ]
 * ```
 *
 * @module memory/io/ChatGptImporter
 */
import type { ImportOptions, ImportResult } from './facade/types.js';
import type { SqliteBrain } from '../retrieval/store/SqliteBrain.js';
/**
 * Imports a ChatGPT `conversations.json` export into a `SqliteBrain`.
 *
 * **Usage:**
 * ```ts
 * const importer = new ChatGptImporter(brain);
 * const result = await importer.import('/path/to/conversations.json');
 * ```
 */
export declare class ChatGptImporter {
    private readonly brain;
    /**
     * @param brain - The target `SqliteBrain` to import into.
     */
    constructor(brain: SqliteBrain);
    /**
     * Parse `conversations.json` and import all conversations and message pairs.
     *
     * @param sourcePath - Absolute path to the ChatGPT `conversations.json` file.
     * @returns `ImportResult` with counts of imported traces, skipped duplicates,
     *   and any per-item error messages.
     */
    import(sourcePath: string, options?: Pick<ImportOptions, 'dedup'>): Promise<ImportResult>;
    /**
     * Import a single ChatGPT conversation object.
     *
     * Creates a `conversations` row and then iterates through the message
     * mapping in tree order (BFS), pairing adjacent user/assistant messages
     * into episodic memory traces.
     *
     * @param convo  - Raw ChatGPT conversation object.
     * @param result - Mutable result accumulator.
     */
    private _importConversation;
    /**
     * Insert a single episodic memory trace derived from a message pair.
     *
     * Deduplication is based on SHA-256 of the combined `content` string.
     *
     * @param content        - The `[user]:...\n[assistant]:...` content string.
     * @param createdAt      - Unix timestamp (ms) of the user message.
     * @param conversationId - ID of the parent conversation row.
     * @param result         - Mutable result accumulator.
     */
    private _insertEpisodicTrace;
}
//# sourceMappingURL=ChatGptImporter.d.ts.map