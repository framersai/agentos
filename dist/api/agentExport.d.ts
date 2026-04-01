/**
 * @fileoverview Agent configuration export/import for AgentOS.
 * @module @framers/agentos/api/agentExport
 *
 * Provides portable serialization and deserialization of agent and agency
 * configurations. Agents can be exported as JSON or YAML, transferred across
 * environments, and re-imported to create identical agent instances.
 *
 * The export captures the full `BaseAgentConfig` surface — model, tools,
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
 * import { exportAgentConfig, importAgent, exportAgentConfigJSON } from '../api/agentExport';
 *
 * const myAgent = agent({ model: 'openai:gpt-4o', instructions: 'Be helpful.' });
 * const json = exportAgentConfigJSON(myAgent);
 *
 * // Later, in another process:
 * const restored = importAgentFromJSON(json);
 * const reply = await restored.generate('Hello!');
 * ```
 */
import type { Agent } from './types.js';
import { exportAgentConfig, exportAgentConfigJSON } from './agentExportCore.js';
export { exportAgentConfig, exportAgentConfigJSON };
export type { AgentExportConfig } from './agentExportCore.js';
import type { AgentExportConfig } from './agentExportCore.js';
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
export declare function exportAgentConfigYAML(agentInstance: Agent, metadata?: AgentExportConfig['metadata']): string;
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
export declare function importAgent(exportConfig: AgentExportConfig): Agent;
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
export declare function importAgentFromJSON(json: string): Agent;
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
export declare function importAgentFromYAML(yamlStr: string): Agent;
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
export declare function validateAgentExport(config: unknown): {
    valid: boolean;
    errors: string[];
};
//# sourceMappingURL=agentExport.d.ts.map