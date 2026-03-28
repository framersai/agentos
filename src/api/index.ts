/**
 * Public API surface for AgentOS.
 *
 * High-level functions for text generation, agents, agencies, and media.
 * Internal runtime (orchestrator, turn pipeline, handlers) is intentionally
 * NOT exported here — import those directly when needed.
 *
 * @module agentos/api
 */

// --- Core entry points ---
export { AgentOS, type AgentOSConfig } from './AgentOS.js';
export type { AgentOSInput } from './types/AgentOSInput.js';
export type { AgentOSResponse } from './types/AgentOSResponse.js';
export type { AgentOSToolResult } from './types/AgentOSToolResult.js';
export type { AgentOSExternalToolRequest } from './types/AgentOSExternalToolRequest.js';

// --- High-level generation functions ---
export { generateText, type GenerateTextOptions, type GenerateTextResult } from './generateText.js';
export { streamText } from './streamText.js';
export { generateObject } from './generateObject.js';
export { streamObject } from './streamObject.js';
export { embedText } from './embedText.js';
export { generateImage } from './generateImage.js';

// --- Agent & Agency ---
export { agent } from './agent.js';
export { agency } from './agency.js';
export { agentExport } from './agentExport.js';

// --- Errors ---
export * from './errors.js';
