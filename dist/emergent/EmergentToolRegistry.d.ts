/**
 * @fileoverview EmergentToolRegistry — tiered lifecycle manager for emergent tools.
 * @module @framers/agentos/emergent/EmergentToolRegistry
 *
 * Manages the lifecycle of emergent tools across three trust tiers:
 *
 * - **Session tier**: In-memory `Map`, auto-cleaned when the session ends.
 *   Tools at this tier live only for the duration of the agent session. When a
 *   storage adapter is available they are also mirrored into SQLite for
 *   inspection/debugging and removed during session cleanup.
 *
 * - **Agent tier**: Persisted in SQLite via the `agentos_emergent_tools` table.
 *   Tools at this tier are scoped to the agent that created them and survive
 *   across sessions.
 *
 * - **Shared tier**: Same SQLite table, discoverable by all agents. Promotion
 *   to shared tier requires explicit human or system approval.
 *
 * All state changes are logged to an in-memory audit trail (and to the
 * `agentos_emergent_audit_log` table when a storage adapter is provided).
 *
 * The registry operates fully in-memory when no storage adapter is supplied,
 * making it suitable for testing and ephemeral agents.
 */
import type { EmergentTool, ToolTier, ToolUsageStats, EmergentConfig } from './types.js';
/**
 * Minimal storage adapter interface for SQLite persistence.
 *
 * The registry uses this abstraction so it can work with any SQLite driver
 * (better-sqlite3, sql.js, Drizzle raw, etc.) without taking a hard dependency.
 * All methods are async to support both sync and async driver wrappers.
 */
export interface IStorageAdapter {
    /**
     * Execute a single SQL statement that does not return rows.
     * Used for INSERT, UPDATE, DELETE, and DDL statements.
     *
     * @param sql - The SQL statement to execute.
     * @param params - Optional positional parameters bound to `?` placeholders.
     */
    run(sql: string, params?: unknown[]): Promise<unknown>;
    /**
     * Execute a single SQL query and return the first matching row.
     *
     * @param sql - The SQL SELECT statement.
     * @param params - Optional positional parameters bound to `?` placeholders.
     * @returns The first row as a plain object, or `undefined` if no rows match.
     */
    get(sql: string, params?: unknown[]): Promise<unknown>;
    /**
     * Execute a single SQL query and return all matching rows.
     *
     * @param sql - The SQL SELECT statement.
     * @param params - Optional positional parameters bound to `?` placeholders.
     * @returns An array of plain objects, one per matching row.
     */
    all(sql: string, params?: unknown[]): Promise<unknown[]>;
    /**
     * Execute a raw SQL string containing one or more statements.
     * Used for schema DDL (CREATE TABLE, CREATE INDEX).
     * Not all adapters support this — the registry falls back to `run()` if absent.
     *
     * @param sql - The raw SQL string to execute.
     */
    exec?(sql: string): Promise<void>;
}
/**
 * A single entry in the emergent tool audit trail.
 *
 * Audit entries record every significant state change: registration, promotion,
 * demotion, usage recording, and session cleanup. They are stored both in-memory
 * and (when a storage adapter is provided) in the `agentos_emergent_audit_log`
 * SQLite table.
 */
export interface AuditEntry {
    /** Unique identifier for this audit entry. */
    id: string;
    /** The tool ID this event pertains to. */
    toolId: string;
    /** Machine-readable event type (e.g., `'register'`, `'promote'`, `'demote'`). */
    eventType: string;
    /** Optional structured data associated with the event. */
    data?: unknown;
    /** Unix epoch millisecond timestamp of when the event occurred. */
    timestamp: number;
}
/**
 * Manages the lifecycle of emergent tools across three trust tiers.
 *
 * The registry stores session-tier tools in an in-memory Map (keyed by tool ID)
 * and mirrors them to SQLite when available for audit/inspection. Agent/shared
 * tier tools live in the persisted map and are written to SQLite (when a
 * storage adapter is provided) or kept in-memory as fallback.
 *
 * Key responsibilities:
 * - **Registration**: Accept new tools at a given tier, enforcing config limits.
 * - **Lookup**: Retrieve tools by ID or filter by tier with optional scope.
 * - **Usage tracking**: Record invocations and update rolling statistics.
 * - **Promotion / demotion**: Move tools between tiers with audit logging.
 * - **Session cleanup**: Bulk-remove all session-scoped tools for a given session.
 * - **Audit trail**: Log every state change for observability and debugging.
 *
 * @example
 * ```ts
 * const registry = new EmergentToolRegistry({ ...DEFAULT_EMERGENT_CONFIG, enabled: true });
 * registry.register(tool, 'session');
 * registry.recordUse(tool.id, { x: 1 }, { y: 2 }, true, 42);
 * const stats = registry.getUsageStats(tool.id);
 * ```
 */
export declare class EmergentToolRegistry {
    /** In-memory store for session-tier tools, keyed by tool ID. */
    private readonly sessionTools;
    /** In-memory store for agent/shared-tier tools when no DB is available. */
    private readonly persistedTools;
    /** In-memory audit log. Always populated regardless of DB availability. */
    private readonly auditLog;
    /** Resolved configuration, merged with defaults. */
    private readonly config;
    /** Optional SQLite storage adapter for agent/shared tier persistence. */
    private readonly db?;
    /** Whether `ensureSchema()` has been called and completed. */
    private schemaReady;
    /**
     * Cached promise from the first `ensureSchemaReady()` call.
     * Guards against the race condition where multiple callers invoke
     * `ensureSchema()` concurrently — without this, the second caller could
     * start DB operations before the first's DDL statements finish.
     */
    private schemaReadyPromise;
    /**
     * Create a new EmergentToolRegistry.
     *
     * @param config - Emergent capability configuration. Missing fields are
     *   filled from {@link DEFAULT_EMERGENT_CONFIG}.
     * @param db - Optional SQLite storage adapter. When provided, agent and
     *   shared tier tools are persisted to the `agentos_emergent_tools` table.
     *   When omitted, all tiers use in-memory storage only.
     */
    constructor(config?: Partial<EmergentConfig>, db?: IStorageAdapter);
    /**
     * Idempotent schema readiness guard.
     *
     * Ensures `ensureSchema()` is called exactly once and all subsequent callers
     * await the same in-flight promise. This prevents the race condition where
     * concurrent DB operations start before DDL statements finish.
     *
     * @returns A promise that resolves when the schema is ready.
     */
    ensureSchemaReady(): Promise<void>;
    /**
     * Initialize the database schema for emergent tool persistence.
     *
     * Creates the `agentos_emergent_tools` and `agentos_emergent_audit_log`
     * tables along with their indexes. Safe to call multiple times — all
     * statements use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.
     *
     * This method is a no-op when no storage adapter was provided.
     *
     * @throws If the storage adapter's `exec` or `run` method rejects.
     */
    ensureSchema(): Promise<void>;
    /**
     * Register a new emergent tool at the given tier.
     *
     * Session-tier tools are stored in the in-memory session map and mirrored to
     * SQLite when available. Agent and shared tier tools are stored in the
     * persisted map (and written to SQLite when a storage adapter is available).
     *
     * @param tool - The emergent tool to register. Must have a unique `id`.
     * @param tier - The tier to register the tool at. The tool's `tier` property
     *   is updated to match.
     *
     * @throws {Error} If the maximum tool count for the target tier is exceeded
     *   (checked against `maxSessionTools` or `maxAgentTools` from config).
     * @throws {Error} If a tool with the same ID is already registered.
     */
    register(tool: EmergentTool, tier: ToolTier): void;
    /**
     * Retrieve a tool by its unique identifier.
     *
     * Searches all tiers (session first, then persisted agent/shared).
     *
     * @param toolId - The tool ID to look up.
     * @returns The tool if found, or `undefined` if no tool with that ID exists.
     */
    get(toolId: string): EmergentTool | undefined;
    /**
     * Upsert a tool into the registry, replacing any prior in-memory copy.
     *
     * Used to hydrate persisted/shared tools back into a live runtime so they can
     * become executable again after process restart or admin promotion.
     */
    upsert(tool: EmergentTool): void;
    /**
     * Remove a tool from the registry entirely.
     *
     * Used to roll back newly forged tools when downstream activation fails.
     */
    remove(toolId: string): boolean;
    /**
     * Get all tools registered at a specific tier, optionally filtered by scope.
     *
     * @param tier - The tier to query (`'session'`, `'agent'`, or `'shared'`).
     * @param scope - Optional scope filter. When provided, results are narrowed:
     *   - `sessionId`: Match tools whose `source` string contains the session ID.
     *   - `agentId`: Match tools whose `createdBy` equals the agent ID.
     * @returns An array of matching tools (may be empty).
     */
    getByTier(tier: ToolTier, scope?: {
        sessionId?: string;
        agentId?: string;
    }): EmergentTool[];
    /**
     * Record a tool invocation, updating rolling usage statistics.
     *
     * Updates the tool's {@link ToolUsageStats} in place:
     * - Increments `totalUses`.
     * - Increments `successCount` or `failureCount` based on the `success` flag.
     * - Recalculates `avgExecutionTimeMs` as a running average.
     * - Recalculates `confidenceScore` as `successCount / totalUses`.
     * - Sets `lastUsedAt` to the current ISO-8601 timestamp.
     *
     * @param toolId - The ID of the tool that was invoked.
     * @param _input - The input arguments passed to the tool (logged for audit).
     * @param _output - The output returned by the tool (logged for audit).
     * @param success - Whether the invocation completed successfully.
     * @param executionTimeMs - Wall-clock execution time in milliseconds.
     *
     * @throws {Error} If no tool with the given ID is registered.
     */
    recordUse(toolId: string, _input: unknown, _output: unknown, success: boolean, executionTimeMs: number): void;
    /**
     * Retrieve usage statistics for a registered tool.
     *
     * @param toolId - The tool ID to look up.
     * @returns The tool's {@link ToolUsageStats}, or `undefined` if the tool
     *   is not registered.
     */
    getUsageStats(toolId: string): ToolUsageStats | undefined;
    /**
     * Promote a tool to a higher lifecycle tier.
     *
     * Moves the tool from its current tier to `targetTier`. If the tool was at
     * session tier, it is removed from the session map and added to the persisted
     * map. If a storage adapter is available and the target tier is agent or
     * shared, the tool is persisted to the database.
     *
     * @param toolId - The ID of the tool to promote.
     * @param targetTier - The target tier to promote to. Must be strictly higher
     *   than the tool's current tier.
     * @param approvedBy - Optional identifier of the human or system entity that
     *   approved the promotion.
     *
     * @throws {Error} If the tool is not found.
     * @throws {Error} If `targetTier` is not higher than the tool's current tier.
     */
    promote(toolId: string, targetTier: ToolTier, approvedBy?: string): Promise<void>;
    /**
     * Demote or deactivate a tool.
     *
     * Marks the tool as inactive by setting a sentinel on its usage stats
     * (`confidenceScore` set to 0) and logs the demotion event with a reason.
     *
     * Inactive tools are still retrievable via `get()` but should be filtered
     * out by callers when building tool lists for the LLM.
     *
     * @param toolId - The ID of the tool to demote.
     * @param reason - Human-readable explanation for why the tool is being demoted.
     *
     * @throws {Error} If the tool is not found.
     */
    demote(toolId: string, reason: string): void;
    /**
     * Remove all session-tier tools associated with a specific session.
     *
     * Iterates the session map and deletes every tool whose `source` string
     * contains the given session ID. Logs a cleanup audit event for each
     * removed tool.
     *
     * @param sessionId - The session identifier to match against tool `source`
     *   strings.
     * @returns The number of tools removed.
     */
    cleanupSession(sessionId: string): number;
    /**
     * Retrieve audit log entries, optionally filtered by tool ID.
     *
     * @param toolId - When provided, only entries for this tool are returned.
     * @returns An array of {@link AuditEntry} objects in chronological order.
     */
    getAuditLog(toolId?: string): AuditEntry[];
    /**
     * Log an audit event to both the in-memory trail and (optionally) the database.
     *
     * @param toolId - The tool this event pertains to.
     * @param eventType - Machine-readable event type string.
     * @param data - Optional structured data to attach to the event.
     */
    private logAudit;
    /**
     * Upsert a tool record into the `agentos_emergent_tools` SQLite table.
     *
     * Uses INSERT OR REPLACE to handle both initial persistence and updates
     * after promotion.
     *
     * @param tool - The emergent tool to persist.
     * @param approvedBy - Optional identifier of the promotion approver.
     */
    private persistToolToDb;
    private serializeSandboxImplementation;
}
//# sourceMappingURL=EmergentToolRegistry.d.ts.map