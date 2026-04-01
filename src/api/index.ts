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
export type { AgentOSToolResultInput } from './types/AgentOSToolResultInput.js';
export type { AgentOSPendingExternalToolRequest } from './types/AgentOSPendingExternalToolRequest.js';

// --- High-level generation functions ---
export {
  generateText,
  isRetryableError,
  buildFallbackChain,
  type GenerateTextOptions,
  type GenerateTextResult,
  type FallbackProviderEntry,
  type Message,
  type ToolCallRecord,
  type TokenUsage,
} from './generateText.js';
export { streamText } from './streamText.js';
export { generateObject } from './generateObject.js';
export { streamObject } from './streamObject.js';
export { embedText } from './embedText.js';
export { generateImage } from './generateImage.js';

// --- Agent & Agency ---
export { agent } from './agent.js';
export { agency } from './agency.js';
export { exportAgent } from './exportAgent.js';

// --- Model routing ---
export type { IModelRouter, ModelRouteParams, ModelRouteResult } from '../core/llm/routing/IModelRouter.js';
export { ModelRouter } from '../core/llm/routing/ModelRouter.js';

// --- Generation hooks ---
export type { GenerationHookContext, GenerationHookResult, ToolCallHookInfo } from './generateText.js';

// --- Memory, PromptEngine, Skills (for agent() integration) ---
export { AgentMemory } from '../memory/AgentMemory.js';
export type { IPromptEngine } from '../core/llm/IPromptEngine.js';
export type { SkillEntry } from '../skills/types.js';
export { SkillRegistry } from '../skills/SkillRegistry.js';

// --- Avatar types ---
export type {
  AvatarConfig,
  AvatarRuntimeMode,
  AvatarAnchorAssets,
  AvatarStyleProjection,
  AvatarDriftGuard,
  AvatarBindingInputs,
  AvatarRiveProfile,
  AvatarSpriteProfile,
} from './types.js';

// --- Errors ---
export * from './errors.js';
