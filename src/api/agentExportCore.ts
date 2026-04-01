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
 * Extracts the stored configuration from an Agent instance.
 *
 * The agent's config is captured at creation time by the `agent()` and
 * `agency()` factories and attached as a non-enumerable `__config` property.
 */
function extractConfig(agentInstance: Agent): BaseAgentConfig {
  const config = (agentInstance as unknown as Record<string, unknown>).__config;
  if (config && typeof config === 'object') {
    return config as BaseAgentConfig;
  }
  return {};
}

/**
 * Extracts agency-specific fields from an Agent instance that was created
 * by the `agency()` factory.
 */
function extractAgencyFields(agentInstance: Agent):
  | {
      agents?: Record<string, BaseAgentConfig>;
      strategy?: AgencyStrategy;
      adaptive?: boolean;
      maxRounds?: number;
    }
  | undefined {
  const raw = (agentInstance as unknown as Record<string, unknown>).__agencyConfig;
  if (raw && typeof raw === 'object') {
    return raw as {
      agents?: Record<string, BaseAgentConfig>;
      strategy?: AgencyStrategy;
      adaptive?: boolean;
      maxRounds?: number;
    };
  }
  return undefined;
}

/**
 * Exports an agent's configuration as a portable object.
 */
export function exportAgentConfig(
  agentInstance: Agent,
  metadata?: AgentExportConfig['metadata']
): AgentExportConfig {
  const config = extractConfig(agentInstance);
  const agencyFields = extractAgencyFields(agentInstance);
  const isAgency = !!agencyFields?.agents;

  const exportConfig: AgentExportConfig = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    type: isAgency ? 'agency' : 'agent',
    config,
  };

  if (isAgency && agencyFields) {
    exportConfig.agents = agencyFields.agents;
    exportConfig.strategy = agencyFields.strategy;
    exportConfig.adaptive = agencyFields.adaptive;
    exportConfig.maxRounds = agencyFields.maxRounds;
  }

  if (metadata) {
    exportConfig.metadata = metadata;
  }

  return exportConfig;
}

/**
 * Exports an agent's configuration as pretty-printed JSON.
 */
export function exportAgentConfigJSON(
  agentInstance: Agent,
  metadata?: AgentExportConfig['metadata']
): string {
  return JSON.stringify(exportAgentConfig(agentInstance, metadata), null, 2);
}
