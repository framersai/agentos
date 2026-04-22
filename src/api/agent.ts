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
import {
  generateText,
  extractTextFromContent,
  type FallbackProviderEntry,
  type GenerateTextOptions,
  type GenerateTextResult,
  type GenerationHookContext,
  type GenerationHookResult,
  type Message,
  type MessageContent,
  type ToolCallHookInfo,
} from './generateText.js';
import { streamText, type StreamTextResult } from './streamText.js';
import type { HostLLMPolicy } from './runtime/hostPolicy.js';
import type { IModelRouter } from '../core/llm/routing/IModelRouter.js';
import type { SkillEntry } from '../skills/types.js';
import type {
  AgentOSUsageAggregate,
  AgentOSUsageLedgerOptions,
} from './runtime/usageLedger.js';
import { warnOnDeferredLightweightAgentCapabilities } from './runtime/lightweightAgentDiagnostics.js';
import type { BaseAgentConfig } from './types.js';
import { exportAgentConfig, exportAgentConfigJSON, type AgentExportConfig } from './agentExportCore.js';
import { applyMemoryProvider } from './runtime/memoryProviderHooks.js';

/**
 * Provider hook interface consumed by `agent()` for memory integration.
 *
 * When provided on the agent config, `getContext` is called before each
 * LLM generation to inject retrieved memory into the system prompt, and
 * `observe` is called after each turn to encode the exchange for future
 * recall. Both hooks are optional — implementations may choose to provide
 * read-only or write-only memory behavior.
 *
 * Auto-wires on every agent call path as of AgentOS 0.2.0: direct
 * `agent.stream()` / `.generate()` and `agent.session().send()` / `.stream()`
 * all invoke the hooks when the provider is present.
 */
export interface AgentMemoryProvider {
  /**
   * Retrieve a memory context block to prepend to the system prompt.
   *
   * @param text - The user input for the current turn.
   * @param opts - Retrieval options. `tokenBudget` caps the memory block size.
   * @returns An object whose `contextText` (when present) is injected as a
   *   system message before the LLM call. Returning `null` or an object
   *   without `contextText` skips injection.
   */
  getContext?: (
    text: string,
    opts?: { tokenBudget?: number },
  ) => Promise<{ contextText?: string } | null>;

  /**
   * Record an observation of a turn exchange.
   *
   * Invoked twice per turn (`role: 'user'` with the input, then
   * `role: 'assistant'` with the reply) as fire-and-forget. Rejections
   * are swallowed so memory-backend errors do not break generation.
   *
   * @param role - Whether the content came from the user or assistant.
   * @param text - Plain text content of the turn.
   */
  observe?: (
    role: 'user' | 'assistant',
    text: string,
  ) => Promise<void>;
}

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
  /** Host-level routing hints forwarded to the high-level generation helpers. */
  hostPolicy?: HostLLMPolicy;
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
   * Optional memory provider. When provided, memory auto-wires on all four
   * agent call paths (see {@link AgentMemoryProvider} for hook contract).
   *
   * - `getContext` runs before each LLM call; result prepended as a system
   *   message.
   * - `observe` runs after each LLM call as fire-and-forget.
   */
  memoryProvider?: AgentMemoryProvider;
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
   * Accepts plain text or multimodal content (text + image parts).
   *
   * @param input - User message as text string or MessageContent array.
   * @returns The full generation result including text, usage, and tool calls.
   */
  send(input: MessageContent): Promise<GenerateTextResult>;
  /**
   * Streams a user message and returns streaming iterables.
   * The assistant reply is appended to session history once the `text` promise resolves.
   * Accepts plain text or multimodal content (text + image parts).
   *
   * @param input - User message as text string or MessageContent array.
   * @returns A {@link StreamTextResult} with async iterables and awaitable aggregates.
   */
  stream(input: MessageContent): StreamTextResult;
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
   * Accepts plain text or multimodal content (text + image parts).
   *
   * @param prompt - User prompt as text string or MessageContent array.
   * @param opts - Optional overrides merged on top of the agent's base options.
   * @returns The complete generation result.
   */
  generate(prompt: MessageContent, opts?: Partial<GenerateTextOptions>): Promise<GenerateTextResult>;
  /**
   * Streams a single reply without maintaining session history.
   * Accepts plain text or multimodal content (text + image parts).
   *
   * @param prompt - User prompt as text string or MessageContent array.
   * @param opts - Optional overrides merged on top of the agent's base options.
   * @returns A {@link StreamTextResult}.
   */
  stream(prompt: MessageContent, opts?: Partial<GenerateTextOptions>): StreamTextResult;
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

function mergeUsageLedgerOptions(
  ...parts: Array<AgentOSUsageLedgerOptions | undefined>
): AgentOSUsageLedgerOptions | undefined {
  const merged = Object.assign({}, ...parts.filter(Boolean));
  return Object.keys(merged).length > 0 ? merged : undefined;
}

async function loadRecordedAgentOSUsage(
  options?: Pick<AgentOSUsageLedgerOptions, 'enabled' | 'path' | 'sessionId' | 'personaId'>
): Promise<AgentOSUsageAggregate> {
  const { getRecordedAgentOSUsage } = await import('./runtime/usageLedger.js');
  return getRecordedAgentOSUsage(options);
}

/** Timeout for memory operations to prevent blocking generation. */
const MEMORY_TIMEOUT_MS = 5000;

/**
 * Convert HEXACO trait values (0-1) into behavioral descriptions the LLM can act on.
 *
 * Each trait produces a directive when it deviates from the neutral midpoint (0.5).
 * High values (>0.65) and low values (<0.35) produce distinct behavioral instructions.
 * Moderate values (0.35-0.65) are omitted to avoid over-constraining the model.
 */
function buildPersonalityDescription(
  traits: Partial<Record<string, number>>
): string | null {
  const lines: string[] = [];
  const v = (key: string) => typeof traits[key] === 'number' ? traits[key]! : 0.5;

  const h = v('honesty');
  const e = v('emotionality');
  const x = v('extraversion');
  const a = v('agreeableness');
  const c = v('conscientiousness');
  const o = v('openness');

  // Honesty-Humility
  if (h > 0.65) lines.push('Be straightforward and transparent. Avoid flattery, spin, or evasion. Acknowledge limitations directly.');
  else if (h < 0.35) lines.push('Be strategically diplomatic. Frame information to serve the conversation goal. Emphasize advantages.');

  // Emotionality
  if (e > 0.65) lines.push('Respond with emotional awareness and empathy. Acknowledge feelings in the conversation. Express concern when appropriate.');
  else if (e < 0.35) lines.push('Maintain emotional composure. Be matter-of-fact and solution-oriented. Keep responses grounded and pragmatic.');

  // Extraversion
  if (x > 0.65) lines.push('Be energetic and engaging. Use vivid language. Take initiative in the conversation. Offer suggestions proactively.');
  else if (x < 0.35) lines.push('Be measured and reflective. Listen more than you speak. Respond thoughtfully rather than quickly. Prefer depth over breadth.');

  // Agreeableness
  if (a > 0.65) lines.push('Prioritize harmony and cooperation. Validate the other perspective before offering alternatives. Be supportive and encouraging.');
  else if (a < 0.35) lines.push('Be direct and challenge-oriented. Question assumptions. Prioritize accuracy over comfort. Push back when something seems wrong.');

  // Conscientiousness
  if (c > 0.65) lines.push('Be thorough and systematic. Structure responses clearly. Follow through on details. Prefer precision over speed.');
  else if (c < 0.35) lines.push('Be flexible and adaptive. Prioritize the big picture over details. Respond quickly. Tolerate ambiguity and improvise.');

  // Openness
  if (o > 0.65) lines.push('Explore creative angles and unconventional ideas. Draw unexpected connections. Question established approaches.');
  else if (o < 0.35) lines.push('Stick to proven approaches and established knowledge. Be practical and concrete. Favor reliability over novelty.');

  if (lines.length === 0) return null;

  return `## Personality & Communication Style\n\n${lines.join('\n')}`;
}

function buildSystemPrompt(opts: AgentOptions): string | undefined {
  const sections: string[] = [];

  if (opts.instructions?.trim()) {
    sections.push(opts.instructions.trim());
  }

  if (opts.name?.trim()) {
    sections.push(`Assistant name: ${opts.name.trim()}.`);
  }

  if (opts.personality) {
    const desc = buildPersonalityDescription(opts.personality);
    if (desc) {
      sections.push(desc);
    }
  }

  // Append skill content as markdown sections
  if (opts.skills?.length) {
    for (const entry of opts.skills) {
      if (entry.skill.content?.trim()) {
        sections.push(entry.skill.content.trim());
      }
    }
  }

  return sections.length > 0 ? sections.join('\n\n') : undefined;
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
export function agent(opts: AgentOptions): Agent {
  const sessions = new Map<string, Message[]>();
  let avatarBindingOverrides: Record<string, unknown> = {};
  const useMemory = opts.memory !== false;

  warnOnDeferredLightweightAgentCapabilities(opts);

  /*
   * Cognitive mechanisms validation.  When the caller provides a
   * `cognitiveMechanisms` config but has memory disabled, the mechanisms
   * cannot be wired (they depend on CognitiveMemoryManager which needs an
   * active memory subsystem).  Log a warning and drop the config.
   */
  if (opts.cognitiveMechanisms && !useMemory) {
    console.warn(
      '[AgentOS] cognitiveMechanisms config was provided but memory is disabled. ' +
      'Mechanisms require memory to be enabled (set `memory: true` or pass a MemoryConfig). ' +
      'The cognitiveMechanisms config will be ignored.',
    );
  }

  /*
   * Resolve the effective usage ledger config.  The top-level `usageLedger`
   * field is a backward-compat alias — if it is present we forward it to
   * `observability.usageLedger`.  An explicit `observability.usageLedger`
   * takes precedence when both are supplied.
   */
  const effectiveLedger: AgentOSUsageLedgerOptions | undefined =
    (opts.observability?.usageLedger as AgentOSUsageLedgerOptions | undefined) ?? opts.usageLedger;

  const baseOpts: Partial<GenerateTextOptions> = {
    provider: opts.provider,
    model: opts.model,
    system: opts.systemBlocks ?? buildSystemPrompt(opts),
    tools: opts.tools,
    maxSteps: opts.maxSteps ?? 5,
    // Per-call completion-token cap applied to every generate /
    // session.send / stream invocation this agent makes. Unset means
    // the underlying generateText falls back to the provider default.
    maxTokens: opts.maxTokens,
    chainOfThought: opts.chainOfThought ?? true,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    usageLedger: effectiveLedger,
    fallbackProviders: opts.fallbackProviders,
    onFallback: opts.onFallback,
    router: opts.router,
    hostPolicy: opts.hostPolicy,
    routerParams: opts.routerParams,
    onBeforeGeneration: opts.onBeforeGeneration,
    onAfterGeneration: opts.onAfterGeneration,
    onBeforeToolExecution: opts.onBeforeToolExecution,
  };

  const agentInstance: Agent = {
    async generate(
      prompt: MessageContent,
      extra?: Partial<GenerateTextOptions>
    ): Promise<GenerateTextResult> {
      const genOpts: Partial<GenerateTextOptions> = {
        ...baseOpts,
        ...extra,
        usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, extra?.usageLedger, {
          source: extra?.usageLedger?.source ?? 'agent.generate',
        }),
      };
      if (typeof prompt === 'string') {
        genOpts.prompt = prompt;
      } else {
        genOpts.messages = [...(genOpts.messages ?? []), { role: 'user', content: prompt }];
      }
      return generateText(genOpts as GenerateTextOptions);
    },

    stream(prompt: MessageContent, extra?: Partial<GenerateTextOptions>): StreamTextResult {
      const streamOpts: Partial<GenerateTextOptions> = {
        ...baseOpts,
        ...extra,
        usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, extra?.usageLedger, {
          source: extra?.usageLedger?.source ?? 'agent.stream',
        }),
      };
      if (typeof prompt === 'string') {
        streamOpts.prompt = prompt;
      } else {
        streamOpts.messages = [...(streamOpts.messages ?? []), { role: 'user', content: prompt }];
      }
      return streamText(streamOpts as GenerateTextOptions);
    },

    session(id?: string): AgentSession {
      const sessionId = id ?? crypto.randomUUID();
      if (!sessions.has(sessionId)) sessions.set(sessionId, []);
      const history = sessions.get(sessionId)!;

      return {
        id: sessionId,

        async send(input: MessageContent): Promise<GenerateTextResult> {
          const textForMemory = typeof input === 'string' ? input : extractTextFromContent(input);
          const userMessage: Message = { role: 'user', content: input };
          const requestMessages = useMemory
            ? [...history, userMessage]
            : [userMessage];

          const wrappedOpts = applyMemoryProvider(
            {
              ...baseOpts,
              messages: requestMessages,
              usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, {
                sessionId,
                source: 'agent.session.send',
              }),
            },
            opts.memoryProvider,
            textForMemory,
          );

          const result = await generateText(wrappedOpts as GenerateTextOptions);
          if (useMemory) {
            history.push(userMessage);
            history.push({ role: 'assistant', content: result.text });
          }

          return result;
        },

        stream(input: MessageContent): StreamTextResult {
          const textForMemory = typeof input === 'string' ? input : extractTextFromContent(input);
          const userMessage: Message = { role: 'user', content: input };

          const wrappedOpts = applyMemoryProvider(
            {
              ...baseOpts,
              messages: useMemory
                ? [...history, userMessage]
                : [userMessage],
              usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, {
                sessionId,
                source: 'agent.session.stream',
              }),
            },
            opts.memoryProvider,
            textForMemory,
          );

          const result = streamText(wrappedOpts as GenerateTextOptions);

          // Capture text for history when done. Memory observe runs inside
          // applyMemoryProvider's onAfterGeneration wrapper so it's not
          // re-fired here.
          if (useMemory) {
            history.push(userMessage);
            void result.text
              .then((replyText) => {
                history.push({ role: 'assistant', content: replyText });
              })
              .catch(() => {
                /* history update failed, non-critical */
              });
          }
          return result;
        },

        messages(): Message[] {
          return [...history];
        },

        async usage(): Promise<AgentOSUsageAggregate> {
          return loadRecordedAgentOSUsage({
            enabled: baseOpts.usageLedger?.enabled,
            path: baseOpts.usageLedger?.path,
            sessionId,
          });
        },

        clear() {
          history.length = 0;
        },
      };
    },

    async usage(sessionId?: string): Promise<AgentOSUsageAggregate> {
      return loadRecordedAgentOSUsage({
        enabled: baseOpts.usageLedger?.enabled,
        path: baseOpts.usageLedger?.path,
        sessionId,
      });
    },

    async close() {
      sessions.clear();
    },

    /**
     * Exports this agent's configuration as a portable object.
     * @param metadata - Optional human-readable metadata to attach.
     * @returns A portable {@link AgentExportConfig} object.
     */
    export(metadata?: AgentExportConfig['metadata']): AgentExportConfig {
      return exportAgentConfig(agentInstance, metadata);
    },

    /**
     * Exports this agent's configuration as a pretty-printed JSON string.
     * @param metadata - Optional human-readable metadata to attach.
     * @returns JSON string with 2-space indentation.
     */
    exportJSON(metadata?: AgentExportConfig['metadata']): string {
      return exportAgentConfigJSON(agentInstance, metadata);
    },

    getAvatarBindings() {
      const cfg = opts.avatar;
      if (!cfg?.enabled) return {} as any;
      const base: Record<string, unknown> = {
        speaking: false,
        emotion: 'neutral',
        intensity: 0,
        stress: 0,
        anger: 0,
        affection: 0,
        trust: 0,
        relationshipWarmth: 0,
      };
      return { ...base, ...avatarBindingOverrides };
    },

    setAvatarBindingOverrides(overrides: Record<string, unknown>) {
      avatarBindingOverrides = { ...avatarBindingOverrides, ...overrides };
    },
  };

  // Stash the original config as a non-enumerable property so that
  // exportAgentConfig() can retrieve it without polluting the public API.
  Object.defineProperty(agentInstance, '__config', {
    value: opts,
    enumerable: false,
    configurable: true,
  });

  return agentInstance;
}
