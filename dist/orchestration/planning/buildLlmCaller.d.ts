/**
 * @file buildLlmCaller.ts
 * @description Factory that creates an `llmCaller` function for any provider.
 *
 * Supports all 16+ AgentOS providers including CLI-based providers
 * (claude-code-cli, gemini-cli) that don't use API keys. Uses the
 * existing `resolveModelOption → resolveProvider → createProviderManager`
 * chain so all provider-specific logic (auth, subprocess, fallback) is
 * handled transparently.
 *
 * Usage:
 * ```ts
 * const caller = await buildLlmCaller({ provider: 'claude-code-cli', model: 'claude-opus-4-6' });
 * const response = await caller('You are a planner.', 'Research AI papers');
 * ```
 */
import type { PlannerConfig } from './types.js';
/**
 * Options for building an LLM caller function.
 *
 * At minimum, provide `provider` OR `model` (or both).
 * If neither is provided, auto-detection from env vars kicks in.
 */
export interface BuildLlmCallerOptions {
    /** Provider ID: 'openai', 'anthropic', 'claude-code-cli', 'gemini-cli', etc. */
    provider?: string;
    /** Model ID: 'gpt-4o', 'claude-opus-4-6', 'gemini-2.5-flash', etc. */
    model?: string;
    /** API key override (not needed for CLI providers). */
    apiKey?: string;
    /** Base URL override (e.g. for OpenRouter, Ollama). */
    baseUrl?: string;
    /** Temperature for planning calls. Default: 0.3. */
    temperature?: number;
    /** Max tokens for planning calls. Default: 4096. */
    maxTokens?: number;
}
/** The shape of the llmCaller function used by MissionPlanner. */
export type LlmCallerFn = PlannerConfig['llmCaller'];
/**
 * Build an `llmCaller` function for any AgentOS-supported provider.
 *
 * This uses the full provider resolution chain:
 *   resolveModelOption → resolveProvider → createProviderManager → getProvider
 *
 * Works with all provider types:
 * - API providers (openai, anthropic, groq, together, mistral, xai, openrouter)
 * - CLI providers (claude-code-cli, gemini-cli) — no API key needed
 * - Local providers (ollama) — requires OLLAMA_BASE_URL
 *
 * The returned function has the signature `(system: string, user: string) => Promise<string>`.
 *
 * @param options - Provider, model, and optional credential overrides.
 * @returns A caller function compatible with `PlannerConfig.llmCaller`.
 */
export declare function buildLlmCaller(options?: BuildLlmCallerOptions): Promise<LlmCallerFn>;
/**
 * Build separate planner and execution callers with potentially different providers.
 *
 * @param plannerOptions - Options for the ToT planning model (strong reasoning).
 * @param executionOptions - Options for agent node execution (can be different).
 * @returns Object with `plannerCaller` and `executionCaller`.
 *
 * @example
 * ```ts
 * const { plannerCaller, executionCaller } = await buildSplitCallers(
 *   { provider: 'claude-code-cli', model: 'claude-opus-4-6' },   // Strong for planning
 *   { provider: 'openai', model: 'gpt-4o' },                      // Fast for execution
 * );
 *
 * const planner = new MissionPlanner({
 *   llmCaller: executionCaller,
 *   plannerLlmCaller: plannerCaller,
 *   plannerModel: 'claude-opus-4-6',
 *   executionModel: 'gpt-4o',
 *   ...
 * });
 * ```
 */
export declare function buildSplitCallers(plannerOptions: BuildLlmCallerOptions, executionOptions?: BuildLlmCallerOptions): Promise<{
    plannerCaller: LlmCallerFn;
    executionCaller: LlmCallerFn;
    plannerModel: string;
    executionModel: string;
}>;
//# sourceMappingURL=buildLlmCaller.d.ts.map