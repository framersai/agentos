/**
 * Shared export-only helpers for lightweight agents and agencies.
 *
 * Kept separate from `agentExport.ts` so the lightweight `agent()` entrypoint
 * can expose config export methods without pulling in agency import/runtime
 * code and optional channel adapters.
 */
import type { BaseAgentConfig, AgencyStrategy, Agent } from './types.js';
/**
 * Portable agent configuration envelope.
 *
 * Wraps a `BaseAgentConfig` with version metadata, export timestamp,
 * and type discriminator so import logic can reconstruct the correct agent
 * variant (single agent vs. multi-agent agency).
 */
export interface AgentExportConfig {
    /** Schema version for forward-compatible deserialization. */
    version: '1.0.0';
    /** ISO 8601 timestamp of when the export was created. */
    exportedAt: string;
    /**
     * Discriminator: `'agent'` for a single-agent export, `'agency'` for
     * a multi-agent export that includes a sub-agent roster.
     */
    type: 'agent' | 'agency';
    /** The full agent configuration. */
    config: BaseAgentConfig;
    /** Sub-agent roster keyed by agent name. Present for agency exports. */
    agents?: Record<string, BaseAgentConfig>;
    /** Orchestration strategy. Present for agency exports. */
    strategy?: AgencyStrategy;
    /** Whether runtime strategy adaptation is enabled. */
    adaptive?: boolean;
    /** Maximum orchestration rounds for iterative strategies. */
    maxRounds?: number;
    /** Human-readable metadata about the export (name, author, tags, etc.). */
    metadata?: {
        name?: string;
        description?: string;
        author?: string;
        tags?: string[];
    };
}
/**
 * Exports an agent's configuration as a portable object.
 */
export declare function exportAgentConfig(agentInstance: Agent, metadata?: AgentExportConfig['metadata']): AgentExportConfig;
/**
 * Exports an agent's configuration as pretty-printed JSON.
 */
export declare function exportAgentConfigJSON(agentInstance: Agent, metadata?: AgentExportConfig['metadata']): string;
//# sourceMappingURL=agentExportCore.d.ts.map