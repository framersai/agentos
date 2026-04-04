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
import { generateText, } from './generateText.js';
import { streamText } from './streamText.js';
import { exportAgentConfig, exportAgentConfigJSON } from './agentExportCore.js';
function mergeUsageLedgerOptions(...parts) {
    const merged = Object.assign({}, ...parts.filter(Boolean));
    return Object.keys(merged).length > 0 ? merged : undefined;
}
async function loadRecordedAgentOSUsage(options) {
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
function buildPersonalityDescription(traits) {
    const lines = [];
    const v = (key) => typeof traits[key] === 'number' ? traits[key] : 0.5;
    const h = v('honesty');
    const e = v('emotionality');
    const x = v('extraversion');
    const a = v('agreeableness');
    const c = v('conscientiousness');
    const o = v('openness');
    // Honesty-Humility
    if (h > 0.65)
        lines.push('Be straightforward and transparent. Avoid flattery, spin, or evasion. Acknowledge limitations directly.');
    else if (h < 0.35)
        lines.push('Be strategically diplomatic. Frame information to serve the conversation goal. Emphasize advantages.');
    // Emotionality
    if (e > 0.65)
        lines.push('Respond with emotional awareness and empathy. Acknowledge feelings in the conversation. Express concern when appropriate.');
    else if (e < 0.35)
        lines.push('Maintain emotional composure. Be matter-of-fact and solution-oriented. Keep responses grounded and pragmatic.');
    // Extraversion
    if (x > 0.65)
        lines.push('Be energetic and engaging. Use vivid language. Take initiative in the conversation. Offer suggestions proactively.');
    else if (x < 0.35)
        lines.push('Be measured and reflective. Listen more than you speak. Respond thoughtfully rather than quickly. Prefer depth over breadth.');
    // Agreeableness
    if (a > 0.65)
        lines.push('Prioritize harmony and cooperation. Validate the other perspective before offering alternatives. Be supportive and encouraging.');
    else if (a < 0.35)
        lines.push('Be direct and challenge-oriented. Question assumptions. Prioritize accuracy over comfort. Push back when something seems wrong.');
    // Conscientiousness
    if (c > 0.65)
        lines.push('Be thorough and systematic. Structure responses clearly. Follow through on details. Prefer precision over speed.');
    else if (c < 0.35)
        lines.push('Be flexible and adaptive. Prioritize the big picture over details. Respond quickly. Tolerate ambiguity and improvise.');
    // Openness
    if (o > 0.65)
        lines.push('Explore creative angles and unconventional ideas. Draw unexpected connections. Question established approaches.');
    else if (o < 0.35)
        lines.push('Stick to proven approaches and established knowledge. Be practical and concrete. Favor reliability over novelty.');
    if (lines.length === 0)
        return null;
    return `## Personality & Communication Style\n\n${lines.join('\n')}`;
}
function buildSystemPrompt(opts) {
    const sections = [];
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
export function agent(opts) {
    const sessions = new Map();
    let avatarBindingOverrides = {};
    const useMemory = opts.memory !== false;
    /*
     * Cognitive mechanisms validation.  When the caller provides a
     * `cognitiveMechanisms` config but has memory disabled, the mechanisms
     * cannot be wired (they depend on CognitiveMemoryManager which needs an
     * active memory subsystem).  Log a warning and drop the config.
     */
    if (opts.cognitiveMechanisms && !useMemory) {
        console.warn('[AgentOS] cognitiveMechanisms config was provided but memory is disabled. ' +
            'Mechanisms require memory to be enabled (set `memory: true` or pass a MemoryConfig). ' +
            'The cognitiveMechanisms config will be ignored.');
    }
    /*
     * Resolve the effective usage ledger config.  The top-level `usageLedger`
     * field is a backward-compat alias — if it is present we forward it to
     * `observability.usageLedger`.  An explicit `observability.usageLedger`
     * takes precedence when both are supplied.
     */
    const effectiveLedger = opts.observability?.usageLedger ?? opts.usageLedger;
    const baseOpts = {
        provider: opts.provider,
        model: opts.model,
        system: opts.systemBlocks ?? buildSystemPrompt(opts),
        tools: opts.tools,
        maxSteps: opts.maxSteps ?? 5,
        chainOfThought: opts.chainOfThought ?? true,
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
        usageLedger: effectiveLedger,
        fallbackProviders: opts.fallbackProviders,
        onFallback: opts.onFallback,
        router: opts.router,
        onBeforeGeneration: opts.onBeforeGeneration,
        onAfterGeneration: opts.onAfterGeneration,
        onBeforeToolExecution: opts.onBeforeToolExecution,
    };
    const agentInstance = {
        async generate(prompt, extra) {
            return generateText({
                ...baseOpts,
                ...extra,
                prompt,
                usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, extra?.usageLedger, {
                    source: extra?.usageLedger?.source ?? 'agent.generate',
                }),
            });
        },
        stream(prompt, extra) {
            return streamText({
                ...baseOpts,
                ...extra,
                prompt,
                usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, extra?.usageLedger, {
                    source: extra?.usageLedger?.source ?? 'agent.stream',
                }),
            });
        },
        session(id) {
            const sessionId = id ?? crypto.randomUUID();
            if (!sessions.has(sessionId))
                sessions.set(sessionId, []);
            const history = sessions.get(sessionId);
            return {
                id: sessionId,
                async send(text) {
                    // Memory recall before generation
                    let memorySystemMsg;
                    if (opts.memoryProvider?.getContext) {
                        try {
                            const ctx = await Promise.race([
                                opts.memoryProvider.getContext(text, { tokenBudget: 2000 }),
                                new Promise((resolve) => setTimeout(() => resolve(null), MEMORY_TIMEOUT_MS)),
                            ]);
                            if (ctx?.contextText) {
                                memorySystemMsg = ctx.contextText;
                            }
                        }
                        catch {
                            // Memory recall failure is non-fatal
                        }
                    }
                    // Prepend memory context to system prompt
                    let system = baseOpts.system;
                    if (memorySystemMsg) {
                        system = [memorySystemMsg, system].filter(Boolean).join('\n\n') || undefined;
                    }
                    const requestMessages = useMemory
                        ? [...history, { role: 'user', content: text }]
                        : [{ role: 'user', content: text }];
                    const result = await generateText({
                        ...baseOpts,
                        system,
                        messages: requestMessages,
                        usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, {
                            sessionId,
                            source: 'agent.session.send',
                        }),
                    });
                    if (useMemory) {
                        history.push({ role: 'user', content: text });
                        history.push({ role: 'assistant', content: result.text });
                    }
                    // Memory observe after generation (fire-and-forget)
                    if (opts.memoryProvider?.observe) {
                        opts.memoryProvider.observe('user', text).catch(() => { });
                        if (result.text) {
                            opts.memoryProvider.observe('assistant', result.text).catch(() => { });
                        }
                    }
                    return result;
                },
                stream(text) {
                    // For streaming, use onBeforeGeneration hook to inject memory context
                    const originalBeforeHook = baseOpts.onBeforeGeneration;
                    const result = streamText({
                        ...baseOpts,
                        messages: useMemory
                            ? [...history, { role: 'user', content: text }]
                            : [{ role: 'user', content: text }],
                        onBeforeGeneration: opts.memoryProvider?.getContext
                            ? async (ctx) => {
                                // Inject memory context
                                try {
                                    const memCtx = await Promise.race([
                                        opts.memoryProvider.getContext(text, { tokenBudget: 2000 }),
                                        new Promise((resolve) => setTimeout(() => resolve(null), MEMORY_TIMEOUT_MS)),
                                    ]);
                                    if (memCtx?.contextText) {
                                        ctx = {
                                            ...ctx,
                                            messages: [
                                                { role: 'system', content: memCtx.contextText },
                                                ...ctx.messages,
                                            ],
                                        };
                                    }
                                }
                                catch { /* non-fatal */ }
                                // Chain with user's hook if present
                                if (originalBeforeHook) {
                                    const userResult = await originalBeforeHook(ctx);
                                    return userResult ?? ctx;
                                }
                                return ctx;
                            }
                            : originalBeforeHook,
                        usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, {
                            sessionId,
                            source: 'agent.session.stream',
                        }),
                    });
                    // Capture text for history when done
                    if (useMemory) {
                        history.push({ role: 'user', content: text });
                        void result.text
                            .then((replyText) => {
                            history.push({ role: 'assistant', content: replyText });
                            // Memory observe after stream completes
                            if (opts.memoryProvider?.observe) {
                                opts.memoryProvider.observe('user', text).catch(() => { });
                                opts.memoryProvider.observe('assistant', replyText).catch(() => { });
                            }
                        })
                            .catch(() => {
                            /* history update failed, non-critical */
                        });
                    }
                    return result;
                },
                messages() {
                    return [...history];
                },
                async usage() {
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
        async usage(sessionId) {
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
        export(metadata) {
            return exportAgentConfig(agentInstance, metadata);
        },
        /**
         * Exports this agent's configuration as a pretty-printed JSON string.
         * @param metadata - Optional human-readable metadata to attach.
         * @returns JSON string with 2-space indentation.
         */
        exportJSON(metadata) {
            return exportAgentConfigJSON(agentInstance, metadata);
        },
        getAvatarBindings() {
            const cfg = opts.avatar;
            if (!cfg?.enabled)
                return {};
            const base = {
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
        setAvatarBindingOverrides(overrides) {
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
//# sourceMappingURL=agent.js.map