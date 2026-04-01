/**
 * @file types.ts
 * Shared configuration types for the AgentOS high-level Agency API.
 *
 * Defines `BaseAgentConfig` — the unified configuration shape accepted by both
 * `agent()` and `agency()` — together with all supporting sub-config interfaces,
 * event types, callback maps, and the discriminated `AgencyStreamPart` union.
 */
// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------
/**
 * Thrown when an `agency()` configuration is invalid (e.g. no agents defined,
 * unknown strategy, conflicting options).
 */
export class AgencyConfigError extends Error {
    /**
     * @param message - Human-readable description of the configuration problem.
     */
    constructor(message) {
        super(message);
        this.name = 'AgencyConfigError';
    }
}
//# sourceMappingURL=types.js.map