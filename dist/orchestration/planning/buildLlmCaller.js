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
export async function buildLlmCaller(options = {}) {
    // Lazy imports to avoid loading heavy modules at module level
    const { resolveModelOption, resolveProvider, createProviderManager } = await import(
    /* webpackIgnore: true */
    '../../api/model.js');
    const temperature = options.temperature ?? 0.3;
    const maxTokens = options.maxTokens ?? 4096;
    // Resolve provider + model via the standard 3-tier chain
    const { providerId, modelId } = resolveModelOption({ provider: options.provider, model: options.model }, 'text');
    const resolved = resolveProvider(providerId, modelId, {
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
    });
    // Create and initialize the provider manager
    const manager = await createProviderManager(resolved);
    const provider = manager.getProvider(resolved.providerId);
    if (!provider) {
        throw new Error(`Provider "${resolved.providerId}" could not be initialized.`);
    }
    // Return a caller function that wraps generateCompletion
    return async (system, user) => {
        const response = await provider.generateCompletion(resolved.modelId, [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ], {
            temperature,
            maxTokens,
            responseFormat: undefined, // Let the provider decide (some don't support JSON mode)
        });
        const content = response.choices?.[0]?.message?.content;
        if (typeof content === 'string') {
            return content;
        }
        if (Array.isArray(content)) {
            return content
                .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
                .join('');
        }
        return '';
    };
}
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
export async function buildSplitCallers(plannerOptions, executionOptions) {
    const { resolveModelOption } = await import(
    /* webpackIgnore: true */
    '../../api/model.js');
    const plannerResolved = resolveModelOption({ provider: plannerOptions.provider, model: plannerOptions.model }, 'text');
    const execOpts = executionOptions ?? plannerOptions;
    const execResolved = resolveModelOption({ provider: execOpts.provider, model: execOpts.model }, 'text');
    const plannerCaller = await buildLlmCaller(plannerOptions);
    const executionCaller = executionOptions
        ? await buildLlmCaller(executionOptions)
        : plannerCaller;
    return {
        plannerCaller,
        executionCaller,
        plannerModel: `${plannerResolved.providerId}/${plannerResolved.modelId}`,
        executionModel: `${execResolved.providerId}/${execResolved.modelId}`,
    };
}
//# sourceMappingURL=buildLlmCaller.js.map