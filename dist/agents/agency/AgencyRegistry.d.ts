/**
 * @file AgencyRegistry.ts
 * @description Registry for tracking active Agency sessions in the AgentOS runtime.
 * @module AgentOS/Agency
 */
import type { ILogger } from '../../logging/ILogger';
import type { AgencySeatHistoryEntry, AgencySeatRegistrationArgs, AgencySeatState, AgencySession, AgencyUpsertArgs } from './AgencyTypes';
/**
 * Tracks the Agencies (multi-GMI collectives) active inside the AgentOS runtime.
 *
 * @remarks
 * The registry is intentionally ephemeral; durable state should be captured via
 * workflow persistence. For shared memory, use {@link AgencyMemoryManager}.
 *
 * @example
 * ```typescript
 * const registry = new AgencyRegistry(logger);
 *
 * // Create agency with shared memory enabled
 * const session = registry.upsertAgency({
 *   workflowId: 'workflow-123',
 *   conversationId: 'conv-456',
 *   memoryConfig: { enabled: true },
 * });
 *
 * // Register GMI seats
 * registry.registerSeat({
 *   agencyId: session.agencyId,
 *   roleId: 'researcher',
 *   gmiInstanceId: 'gmi-789',
 *   personaId: 'research-persona',
 * });
 * ```
 */
export declare class AgencyRegistry {
    private readonly logger?;
    /** Active agency sessions keyed by agency ID */
    private readonly agencies;
    /** Workflow to agency mapping for quick lookup */
    private readonly workflowToAgency;
    /**
     * Creates a new AgencyRegistry instance.
     * @param logger - Optional logger for diagnostics
     */
    constructor(logger?: ILogger | undefined);
    /**
     * Creates or updates an agency session associated with a workflow.
     *
     * @param args - Upsert payload containing workflow linkage, memory config, and optional metadata.
     * @returns The upserted agency session.
     *
     * @example
     * ```typescript
     * const session = registry.upsertAgency({
     *   workflowId: 'workflow-123',
     *   conversationId: 'conv-456',
     *   memoryConfig: {
     *     enabled: true,
     *     autoIngestCommunications: true,
     *   },
     * });
     * ```
     */
    upsertAgency(args: AgencyUpsertArgs): AgencySession;
    /**
     * Retrieves an agency session by identifier.
     * @param agencyId - Target Agency identifier.
     * @returns The matching agency session or `undefined` when absent.
     */
    getAgency(agencyId: string): AgencySession | undefined;
    /**
     * Resolves the agency session associated with a workflow instance (if any).
     * @param workflowId - Workflow instance identifier.
     * @returns The agency session mapped to the workflow, if present.
     */
    getAgencyByWorkflow(workflowId: string): AgencySession | undefined;
    /**
     * Registers or updates a seat inside the agency.
     * @param args - Seat registration payload.
     * @returns Updated agency session after the seat registration.
     * @throws {Error} When attempting to register against an unknown agency.
     */
    registerSeat(args: AgencySeatRegistrationArgs): AgencySession;
    /**
     * Removes an agency entirely (e.g., when the workflow reaches a terminal state).
     * @param agencyId - Agency identifier to remove.
     * @returns `true` when the agency existed and was removed.
     */
    removeAgency(agencyId: string): boolean;
    /**
     * Appends a history entry to the specified seat and returns the updated state.
     */
    appendSeatHistory(agencyId: string, roleId: string, entry: AgencySeatHistoryEntry, maxEntries?: number): AgencySeatState | undefined;
    /**
     * Merges metadata onto a seat without altering other properties.
     */
    mergeSeatMetadata(agencyId: string, roleId: string, metadata: Record<string, unknown>): AgencySeatState | undefined;
    private mutateSeat;
}
//# sourceMappingURL=AgencyRegistry.d.ts.map