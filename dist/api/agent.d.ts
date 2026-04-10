/**
 * @file agent.ts
 * Lightweight stateful agent factory for the AgentOS high-level API.
 *
 * Wraps {@link generateText} and {@link streamText} with per-session conversation
 * history, optional HEXACO-inspired personality shaping, and a named-agent system
 * prompt builder.  Guardrail identifiers are accepted and stored in config but
 * are not actively enforced in this lightweight layer — use the full AgentOS
 * runtime (`AgentOSOrchestrator`) or `agency()` for guardrail enforcement.
 */
import { type FallbackProviderEntry, type GenerateTextOptions, type GenerateTextResult, type GenerationHookContext, type GenerationHookResult, type Message, type ToolCallHookInfo } from './generateText.js';
import { type StreamTextResult } from './streamText.js';
import type { IModelRouter } from '../core/llm/routing/IModelRouter.js';
import type { SkillEntry } from '../skills/types.js';
import type { AgentOSUsageAggregate, AgentOSUsageLedgerOptions } from './runtime/usageLedger.js';
import type { BaseAgentConfig } from './types.js';
import { type AgentExportConfig } from './agentExportCore.js';
/**
 * Configuration options for the {@link agent} factory function.
 *
 * Extends `BaseAgentConfig` with backward-compatible convenience fields.
 * All `BaseAgentConfig` fields (rag, discovery, permissions, emergent, voice,
 * etc.) are accepted and stored in config but are not actively wired in the
 * lightweight agent — they will be consumed by `agency()` and the full runtime.
 */
export interface AgentOptions extends BaseAgentConfig {
    /**
     * Top-level usage ledger shorthand for backward compatibility.
     * When present, forwarded to `observability.usageLedger` internally.
     */
    usageLedger?: AgentOSUsageLedgerOptions;
    /**
     * Chain-of-thought reasoning instruction.
     * - `false` — disable CoT injection.
     * - `true` (default for agents) — inject the default CoT instruction when tools are present.
     * - `string` — inject a custom CoT instruction when tools are present.
     */
    chainOfThought?: boolean | string;
    /**
     * Ordered list of fallback providers to try when the primary provider
     * fails with a retryable error (HTTP 402/429/5xx, network errors).
     *
     * Applied to every `generate()`, `stream()`, and `session.send()` /
     * `session.stream()` call made through this agent.
     *
     * @see {@link GenerateTextOptions.fallbackProviders}
     */
    fallbackProviders?: FallbackProviderEntry[];
    /**
     * Callback invoked when a fallback provider is about to be tried.
     *
     * @param error - The error that triggered the fallback.
     * @param fallbackProvider - The provider identifier being tried next.
     */
    onFallback?: (error: Error, fallbackProvider: string) => void;
    /** Model router for intelligent provider selection per-call. */
    router?: IModelRouter;
    /**
     * Routing hints passed to the model router's `selectModel()` call.
     *
     * Useful for declaring capability requirements up-front so the router
     * can pick a model that actually supports what the agent needs:
     *
     * ```ts
     * agent({
     *   name: 'World Architect',
     *   router: policyAwareRouter,
     *   routerParams: { requiredCapabilities: ['json_mode'] },
     *   output: WorldIdentitySchema,
     * });
     * ```
     *
     * When omitted, the router receives a minimal default params object
     * (taskHint only, plus `function_calling` in requiredCapabilities when
     * tools are declared).
     */
    routerParams?: Partial<import('../core/llm/routing/IModelRouter.js').ModelRouteParams>;
    /**
     * Optional Zod schema for validating the LLM's structured output.
     *
     * When provided, the agent's `generate()` result includes a `parsed` field
     * with the Zod-validated and typed output. JSON extraction and validation
     * happen automatically in the `onAfterGeneration` hook. On validation failure,
     * the agent retries internally (up to `controls.maxValidationRetries ?? 1`).
     *
     * When omitted, behavior is unchanged — `result.parsed` is undefined.
     * This is a non-breaking additive change.
     *
     * @example
     * ```ts
     * import { z } from 'zod';
     * const myAgent = agent({
     *   name: 'Extractor',
     *   instructions: 'Extract entities as JSON',
     *   responseSchema: z.object({ entities: z.array(z.string()) }),
     * });
     * const result = await myAgent.generate('Find entities in: ...');
     * console.log(result.parsed?.entities); // string[]
     * ```
     */
    responseSchema?: import('zod').ZodType;
    /** Pre-generation hook, called before each LLM step. */
    onBeforeGeneration?: (context: GenerationHookContext) => Promise<GenerationHookContext | void>;
    /** Post-generation hook, called after each LLM step. */
    onAfterGeneration?: (result: GenerationHookResult) => Promise<GenerationHookResult | void>;
    /** Pre-tool-execution hook. */
    onBeforeToolExecution?: (info: ToolCallHookInfo) => Promise<ToolCallHookInfo | null>;
    /**
     * Optional memory provider.  When provided:
     * - `session.send()`/`stream()` calls `memory.getContext()` before each turn
     *   and prepends results to the system prompt.
     * - `session.send()`/`stream()` calls `memory.observe()` after each turn
     *   to encode the exchange into long-term memory.
     */
    memoryProvider?: any;
    /**
     * Optional skill entries to inject into the system prompt.
     * Skill content is appended to the system prompt as markdown sections.
     */
    skills?: SkillEntry[];
    /**
     * Structured system prompt blocks with cache breakpoints.
     * When provided, takes precedence over the assembled string from
     * `instructions`, `name`, `personality`, and `skills`.
     * Use this for prompt caching support with Anthropic.
     */
    systemBlocks?: import('./generateText.js').SystemContentBlock[];
}
/**
 * A named conversation session returned by `Agent.session()`.
 * Maintains its own message history independently of other sessions on the same agent.
 */
export interface AgentSession {
    /** Stable session identifier supplied to or auto-generated by `Agent.session()`. */
    readonly id: string;
    /**
     * Sends a user message and returns the complete assistant reply.
     * Appends both turns to the session history when `memory` is enabled.
     *
     * @param text - User message text.
     * @returns The full generation result including text, usage, and tool calls.
     */
    send(text: string): Promise<GenerateTextResult>;
    /**
     * Streams a user message and returns streaming iterables.
     * The assistant reply is appended to session history once the `text` promise resolves.
     *
     * @param text - User message text.
     * @returns A {@link StreamTextResult} with async iterables and awaitable aggregates.
     */
    stream(text: string): StreamTextResult;
    /** Returns a snapshot of the current conversation history for this session. */
    messages(): Message[];
    /** Returns persisted usage totals for this session when the usage ledger is enabled. */
    usage(): Promise<AgentOSUsageAggregate>;
    /** Clears all messages from this session's history. */
    clear(): void;
}
/**
 * A stateful agent instance returned by {@link agent}.
 */
export interface Agent {
    /**
     * Generates a single reply without maintaining session history.
     *
     * @param prompt - User prompt text.
     * @param opts - Optional overrides merged on top of the agent's base options.
     * @returns The complete generation result.
     */
    generate(prompt: string, opts?: Partial<GenerateTextOptions>): Promise<GenerateTextResult>;
    /**
     * Streams a single reply without maintaining session history.
     *
     * @param prompt - User prompt text.
     * @param opts - Optional overrides merged on top of the agent's base options.
     * @returns A {@link StreamTextResult}.
     */
    stream(prompt: string, opts?: Partial<GenerateTextOptions>): StreamTextResult;
    /**
     * Returns (or creates) a named {@link AgentSession} with its own conversation history.
     *
     * @param id - Optional session ID. A unique ID is generated when omitted.
     * @returns The session object for this ID.
     */
    session(id?: string): AgentSession;
    /** Returns persisted usage totals for the whole agent or a single session. */
    usage(sessionId?: string): Promise<AgentOSUsageAggregate>;
    /** Releases all in-memory session state held by this agent. */
    close(): Promise<void>;
    /**
     * Exports the agent's configuration as a portable object.
     * @param metadata - Optional human-readable metadata to attach.
     * @returns A portable {@link AgentExportConfig} object.
     */
    export(metadata?: AgentExportConfig['metadata']): AgentExportConfig;
    /**
     * Exports the agent's configuration as a pretty-printed JSON string.
     * @param metadata - Optional human-readable metadata to attach.
     * @returns JSON string.
     */
    exportJSON(metadata?: AgentExportConfig['metadata']): string;
    /** Read current avatar binding state (auto-populated from mood/voice/relationship). */
    getAvatarBindings(): import('./types').AvatarBindingInputs & Record<string, unknown>;
    /** Inject game-specific binding overrides (healthBand, combatMode, etc.). */
    setAvatarBindingOverrides(overrides: Record<string, unknown>): void;
}
/**
 * Creates a lightweight stateful agent backed by in-memory session storage.
 *
 * The agent wraps {@link generateText} and {@link streamText} with a persistent
 * system prompt built from `instructions`, `name`, and `personality` fields.
 * Multiple independent sessions can be opened via `Agent.session()`.
 *
 * @param opts - Agent configuration including model, instructions, and optional tools.
 *   All `BaseAgentConfig` fields are accepted; advanced fields (rag, discovery,
 *   permissions, emergent, voice, guardrails, etc.) are stored but not actively
 *   wired in the lightweight layer — they are consumed by `agency()` and the full runtime.
 * @returns An {@link Agent} instance with `generate`, `stream`, `session`, and `close` methods.
 *
 * @example
 * ```ts
 * const myAgent = agent({ model: 'openai:gpt-4o', instructions: 'You are a helpful assistant.' });
 * const session = myAgent.session('user-123');
 * const reply = await session.send('Hello!');
 * console.log(reply.text);
 * ```
 */
export declare function agent(opts: AgentOptions): Agent;
//# sourceMappingURL=agent.d.ts.map