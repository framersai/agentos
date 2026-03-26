/**
 * @fileoverview Agent configuration export/import for AgentOS.
 * @module @framers/agentos/api/agentExport
 *
 * Provides portable serialization and deserialization of agent and agency
 * configurations. Agents can be exported as JSON or YAML, transferred across
 * environments, and re-imported to create identical agent instances.
 *
 * The export captures the full {@link BaseAgentConfig} surface — model, tools,
 * personality, guardrails, memory, RAG, voice, channels, etc. — as well as
 * agency-specific fields (sub-agent roster, strategy, rounds).
 *
 * Security note: API keys and base URLs are intentionally **included** in the
 * export for self-contained portability. Callers that publish or share exports
 * should strip sensitive fields first, or use `validateAgentExport()` to
 * inspect the payload before distribution.
 *
 * @example
 * ```ts
 * import { agent } from '@framers/agentos';
 * import { exportAgentConfig, importAgent, exportAgentConfigJSON } from '@framers/agentos/api/agentExport';
 *
 * const myAgent = agent({ model: 'openai:gpt-4o', instructions: 'Be helpful.' });
 * const json = exportAgentConfigJSON(myAgent);
 *
 * // Later, in another process:
 * const restored = importAgentFromJSON(json);
 * const reply = await restored.generate('Hello!');
 * ```
 */

import YAML from 'yaml';

import { agent as createAgent } from './agent.js';
import { agency as createAgency } from './agency.js';
import type {
  BaseAgentConfig,
  AgencyOptions,
  AgencyStrategy,
  Agent,
} from './types.js';

// ============================================================================
// EXPORT CONFIG TYPE
// ============================================================================

/**
 * Portable agent configuration envelope.
 *
 * Wraps a {@link BaseAgentConfig} with version metadata, export timestamp,
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

  // -- Agency-specific fields (present when `type === 'agency'`) --

  /** Sub-agent roster keyed by agent name. Present for agency exports. */
  agents?: Record<string, BaseAgentConfig>;

  /** Orchestration strategy. Present for agency exports. */
  strategy?: AgencyStrategy;

  /** Whether runtime strategy adaptation is enabled. */
  adaptive?: boolean;

  /** Maximum orchestration rounds for iterative strategies. */
  maxRounds?: number;

  // -- Optional metadata --

  /** Human-readable metadata about the export (name, author, tags, etc.). */
  metadata?: {
    /** Display name for the exported agent. */
    name?: string;
    /** Free-text description of what this agent does. */
    description?: string;
    /** Author identifier (person or system). */
    author?: string;
    /** Searchable tags for categorization. */
    tags?: string[];
  };
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

/**
 * Extracts the stored configuration from an Agent instance.
 *
 * The agent's config is captured at creation time by the `agent()` and
 * `agency()` factories and attached as a non-enumerable `__config` property.
 * If the property is absent (e.g. the agent was created by external code),
 * we return an empty config.
 *
 * @param agentInstance - The agent to extract config from.
 * @returns The stored BaseAgentConfig or an empty object.
 */
function extractConfig(agentInstance: Agent): BaseAgentConfig {
  // The __config property is set by our patched agent/agency factories
  const config = (agentInstance as unknown as Record<string, unknown>).__config;
  if (config && typeof config === 'object') {
    return config as BaseAgentConfig;
  }
  // Fallback: no stored config — return empty
  return {};
}

/**
 * Extracts agency-specific fields from an Agent instance that was created
 * by the `agency()` factory.
 *
 * @param agentInstance - The agent/agency to extract from.
 * @returns Agency fields if present, or undefined for plain agents.
 */
function extractAgencyFields(agentInstance: Agent): {
  agents?: Record<string, BaseAgentConfig>;
  strategy?: AgencyStrategy;
  adaptive?: boolean;
  maxRounds?: number;
} | undefined {
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
 * Exports an agent's configuration as a portable {@link AgentExportConfig} object.
 *
 * Captures the full {@link BaseAgentConfig} including model, instructions,
 * personality, tools, guardrails, memory, RAG, voice, channels, and all
 * other configuration surfaces. For agency instances, the sub-agent roster,
 * strategy, and round limits are also included.
 *
 * @param agentInstance - The agent (or agency) instance to export.
 * @param metadata - Optional human-readable metadata to attach to the export.
 * @returns A portable config object that can be serialized to JSON or YAML.
 *
 * @example
 * ```ts
 * const config = exportAgentConfig(myAgent, {
 *   name: 'Research Assistant',
 *   author: 'team-alpha',
 *   tags: ['research', 'summarization'],
 * });
 * ```
 */
export function exportAgentConfig(
  agentInstance: Agent,
  metadata?: AgentExportConfig['metadata'],
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

  // Attach agency-specific fields when present
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
 * Exports an agent's configuration as a pretty-printed JSON string.
 *
 * @param agentInstance - The agent (or agency) instance to export.
 * @param metadata - Optional human-readable metadata to attach.
 * @returns JSON string with 2-space indentation.
 *
 * @example
 * ```ts
 * const json = exportAgentConfigJSON(myAgent);
 * fs.writeFileSync('agent.json', json);
 * ```
 */
export function exportAgentConfigJSON(
  agentInstance: Agent,
  metadata?: AgentExportConfig['metadata'],
): string {
  return JSON.stringify(exportAgentConfig(agentInstance, metadata), null, 2);
}

/**
 * Exports an agent's configuration as a YAML string.
 *
 * Uses the `yaml` npm package for consistent, human-readable output.
 *
 * @param agentInstance - The agent (or agency) instance to export.
 * @param metadata - Optional human-readable metadata to attach.
 * @returns YAML-formatted string.
 *
 * @example
 * ```ts
 * const yamlStr = exportAgentConfigYAML(myAgent);
 * fs.writeFileSync('agent.yaml', yamlStr);
 * ```
 */
export function exportAgentConfigYAML(
  agentInstance: Agent,
  metadata?: AgentExportConfig['metadata'],
): string {
  return YAML.stringify(exportAgentConfig(agentInstance, metadata));
}

// ============================================================================
// IMPORT FUNCTIONS
// ============================================================================

/**
 * Imports an agent from an {@link AgentExportConfig} object.
 *
 * For `type: 'agent'`, calls the `agent()` factory with the stored config.
 * For `type: 'agency'`, calls the `agency()` factory with the stored config
 * plus the sub-agent roster and strategy.
 *
 * The imported agent is a fully functional instance with `generate`, `stream`,
 * `session`, and `close` methods.
 *
 * @param exportConfig - A validated export config object.
 * @returns A new Agent instance constructed from the config.
 *
 * @throws {Error} If the config is invalid or missing required fields.
 *
 * @example
 * ```ts
 * const config = JSON.parse(fs.readFileSync('agent.json', 'utf-8'));
 * const agent = importAgent(config);
 * const reply = await agent.generate('Hello!');
 * ```
 */
export function importAgent(exportConfig: AgentExportConfig): Agent {
  const validation = validateAgentExport(exportConfig);
  if (!validation.valid) {
    throw new Error(
      `Invalid agent export config: ${validation.errors.join('; ')}`,
    );
  }

  if (exportConfig.type === 'agency' && exportConfig.agents) {
    // Reconstruct an agency with its sub-agent roster
    const agencyOpts: AgencyOptions = {
      ...exportConfig.config,
      agents: exportConfig.agents,
      strategy: exportConfig.strategy,
      adaptive: exportConfig.adaptive,
      maxRounds: exportConfig.maxRounds,
    };

    const agencyInstance = createAgency(agencyOpts);

    // Stash config for re-export round-tripping
    Object.defineProperty(agencyInstance, '__config', {
      value: exportConfig.config,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(agencyInstance, '__agencyConfig', {
      value: {
        agents: exportConfig.agents,
        strategy: exportConfig.strategy,
        adaptive: exportConfig.adaptive,
        maxRounds: exportConfig.maxRounds,
      },
      enumerable: false,
      configurable: true,
    });

    return agencyInstance;
  }

  // Single agent
  const agentInstance = createAgent(exportConfig.config);

  // Stash config for re-export round-tripping
  Object.defineProperty(agentInstance, '__config', {
    value: exportConfig.config,
    enumerable: false,
    configurable: true,
  });

  return agentInstance;
}

/**
 * Imports an agent from a JSON string.
 *
 * Parses the string and delegates to {@link importAgent}.
 *
 * @param json - JSON string containing an {@link AgentExportConfig}.
 * @returns A new Agent instance.
 *
 * @throws {SyntaxError} If the JSON is malformed.
 * @throws {Error} If the parsed config fails validation.
 *
 * @example
 * ```ts
 * const agent = importAgentFromJSON(fs.readFileSync('agent.json', 'utf-8'));
 * ```
 */
export function importAgentFromJSON(json: string): Agent {
  const parsed = JSON.parse(json) as AgentExportConfig;
  return importAgent(parsed);
}

/**
 * Imports an agent from a YAML string.
 *
 * Parses the string using the `yaml` npm package and delegates to
 * {@link importAgent}.
 *
 * @param yamlStr - YAML string containing an {@link AgentExportConfig}.
 * @returns A new Agent instance.
 *
 * @throws {Error} If the YAML is malformed or the config fails validation.
 *
 * @example
 * ```ts
 * const agent = importAgentFromYAML(fs.readFileSync('agent.yaml', 'utf-8'));
 * ```
 */
export function importAgentFromYAML(yamlStr: string): Agent {
  const parsed = YAML.parse(yamlStr) as AgentExportConfig;
  return importAgent(parsed);
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates an export config object without importing it.
 *
 * Checks structural correctness: schema version, required fields, type
 * discriminator, and agency-specific field consistency. Does NOT validate
 * the semantic correctness of the config (e.g. whether the model exists).
 *
 * @param config - Unknown value to validate as an {@link AgentExportConfig}.
 * @returns Object with `valid` boolean and an array of error messages.
 *
 * @example
 * ```ts
 * const result = validateAgentExport(someObject);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */
export function validateAgentExport(
  config: unknown,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Config must be a non-null object'] };
  }

  const c = config as Record<string, unknown>;

  // Version check
  if (c.version !== '1.0.0') {
    errors.push(`Unsupported version: ${String(c.version ?? 'missing')}. Expected "1.0.0".`);
  }

  // Type discriminator
  if (c.type !== 'agent' && c.type !== 'agency') {
    errors.push(`Invalid type: ${String(c.type ?? 'missing')}. Expected "agent" or "agency".`);
  }

  // exportedAt must be a string (ISO 8601)
  if (typeof c.exportedAt !== 'string') {
    errors.push('Missing or invalid "exportedAt" field. Expected an ISO 8601 string.');
  }

  // config must be an object
  if (!c.config || typeof c.config !== 'object') {
    errors.push('Missing or invalid "config" field. Expected an object.');
  }

  // Agency-specific: agents must be present when type is 'agency'
  if (c.type === 'agency') {
    if (!c.agents || typeof c.agents !== 'object' || Object.keys(c.agents as object).length === 0) {
      errors.push('Agency export requires a non-empty "agents" roster.');
    }

    // Strategy, if present, must be a valid value
    const validStrategies = new Set([
      'sequential', 'parallel', 'debate', 'review-loop', 'hierarchical', 'graph',
    ]);
    if (c.strategy !== undefined && !validStrategies.has(c.strategy as string)) {
      errors.push(`Invalid strategy: ${String(c.strategy)}. Expected one of: ${[...validStrategies].join(', ')}.`);
    }
  }

  // Metadata validation (optional, but if present must be an object)
  if (c.metadata !== undefined && (typeof c.metadata !== 'object' || c.metadata === null)) {
    errors.push('"metadata" must be an object when present.');
  }

  return { valid: errors.length === 0, errors };
}
