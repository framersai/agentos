/**
 * @file types.ts
 * @description All interfaces, enums, and types for the AgentOS Provenance system.
 * Covers storage policy, provenance config, autonomy config, signed events,
 * revisions, tombstones, anchors, and verification.
 *
 * @module AgentOS/Provenance
 */
// =============================================================================
// Error Types
// =============================================================================
export class ProvenanceViolationError extends Error {
    constructor(message, options) {
        super(message);
        this.name = 'ProvenanceViolationError';
        this.code = options?.code ?? 'PROVENANCE_VIOLATION';
        this.table = options?.table;
        this.operation = options?.operation;
    }
}
//# sourceMappingURL=types.js.map