/**
 * @file sequential.ts
 * Sequential strategy compiler for the Agency API.
 *
 * Iterates agents in declaration order. Each agent receives the previous
 * agent's output as context, forming a chain where the final agent's response
 * is the overall result. Token usage is aggregated across all agent calls.
 */
import { agent as createAgent } from '../agent.js';
import type {
  AgencyOptions,
  CompiledStrategy,
  Agent,
  BaseAgentConfig,
  AgentCallRecord,
  ApprovalRequest,
  AgencyStreamPart,
} from '../types.js';
import { isAgent, mergeDefaults, checkBeforeAgent } from './shared.js';

/**
 * Compiles a sequential execution strategy.
 *
 * Agents are invoked one-by-one in their declared iteration order. Each agent
 * after the first receives a prompt that includes both the original task and
 * the preceding agent's output, enabling progressive refinement chains such as
 * researcher -> editor -> reviewer.
 *
 * @param agents - Named roster of agent configs or pre-built `Agent` instances.
 * @param agencyConfig - Agency-level configuration providing fallback model/provider/tools.
 * @returns A {@link CompiledStrategy} with `execute` and `stream` methods.
 */
export function compileSequential(
  agents: Record<string, BaseAgentConfig | Agent>,
  agencyConfig: AgencyOptions,
): CompiledStrategy {
  return {
    async execute(prompt, opts) {
      const agentCalls: AgentCallRecord[] = [];
      let context = prompt;
      let lastResult: Record<string, unknown> | null = null;
      const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      for (const [name, agentOrConfig] of Object.entries(agents)) {
        /* HITL: check beforeAgent gate before invoking this agent. */
        const decision = await checkBeforeAgent(name, context, agentCalls, agencyConfig);
        if (decision && !decision.approved) {
          /* Agent was rejected — skip and continue to the next agent. */
          continue;
        }

        const a: Agent = isAgent(agentOrConfig)
          ? agentOrConfig
          : createAgent({ ...mergeDefaults(agentOrConfig, agencyConfig) });

        /* Apply instruction modifications from the approval decision if any. */
        const effectiveContext = decision?.modifications?.instructions
          ? `${context}\n\n[Additional instructions]: ${decision.modifications.instructions}`
          : context;

        const start = Date.now();
        const result = (await a.generate(effectiveContext, opts)) as Record<string, unknown>;
        const durationMs = Date.now() - start;

        const resultText = (result.text as string) ?? '';
        const resultUsage = (result.usage as { promptTokens?: number; completionTokens?: number; totalTokens?: number }) ?? {};
        const resultToolCalls = (result.toolCalls as Array<{ name: string; args: unknown; result?: unknown; error?: string }>) ?? [];

        agentCalls.push({
          agent: name,
          input: context,
          output: resultText,
          toolCalls: resultToolCalls,
          usage: {
            promptTokens: resultUsage.promptTokens ?? 0,
            completionTokens: resultUsage.completionTokens ?? 0,
            totalTokens: resultUsage.totalTokens ?? 0,
          },
          durationMs,
        });

        totalUsage.promptTokens += resultUsage.promptTokens ?? 0;
        totalUsage.completionTokens += resultUsage.completionTokens ?? 0;
        totalUsage.totalTokens += resultUsage.totalTokens ?? 0;

        /* Chain: subsequent agents see the original task plus previous output. */
        context = `Original task: ${prompt}\n\nPrevious agent (${name}) output:\n${resultText}`;
        lastResult = result;
      }

      return { ...lastResult, agentCalls, usage: totalUsage };
    },

    stream(prompt, opts) {
      /*
       * Real streaming for the sequential strategy: yields per-agent
       * `agent-start` and `agent-end` events bracketing each agent's text
       * tokens, plus agency-level start/end events wrapping the whole run.
       *
       * `fullStream` emits the full {@link AgencyStreamPart} union so callers
       * can observe every agent transition.  `textStream` filters to just the
       * `text` parts so the result stays compatible with `StreamTextResult`.
       *
       * Usage accounting is collected per-agent and summed into a final total.
       * All promises resolve once the generator has been fully consumed.
       */
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      const startMs = Date.now();

      /**
       * Internal generator that drives the sequential run and yields
       * structured {@link AgencyStreamPart} events.
       */
      async function* streamGenerator(): AsyncGenerator<AgencyStreamPart> {
        let currentPrompt = prompt;
        const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        let finalText = '';

        yield { type: 'agent-start' as const, agent: '__agency__', input: prompt };

        for (const [name, agentOrConfig] of Object.entries(agents)) {
          const agentStart = Date.now();

          yield { type: 'agent-start' as const, agent: name, input: currentPrompt };

          // Resolve agent instance (pre-built or config-based).
          const a: Agent = isAgent(agentOrConfig)
            ? agentOrConfig
            : createAgent({ ...mergeDefaults(agentOrConfig as BaseAgentConfig, agencyConfig) });

          // Delegate to the agent's stream if available, otherwise use generate().
          let agentText = '';
          try {
            const agentStream = a.stream(currentPrompt, opts) as {
              textStream?: AsyncIterable<string>;
              text?: Promise<string>;
            } | null;

            if (agentStream?.textStream) {
              for await (const chunk of agentStream.textStream) {
                yield { type: 'text' as const, text: chunk, agent: name };
                agentText += chunk;
              }
              // If textStream didn't give us the full text, resolve the promise.
              if (!agentText && agentStream.text) {
                agentText = await agentStream.text;
                if (agentText) {
                  yield { type: 'text' as const, text: agentText, agent: name };
                }
              }
            } else {
              // Fallback: non-streaming generate() call.
              const result = (await a.generate(currentPrompt, opts)) as Record<string, unknown>;
              agentText = (result.text as string) ?? '';
              if (agentText) {
                yield { type: 'text' as const, text: agentText, agent: name };
              }
              const resultUsage = (result.usage as { promptTokens?: number; completionTokens?: number; totalTokens?: number }) ?? {};
              totalUsage.promptTokens += resultUsage.promptTokens ?? 0;
              totalUsage.completionTokens += resultUsage.completionTokens ?? 0;
              totalUsage.totalTokens += resultUsage.totalTokens ?? 0;
            }
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            yield { type: 'error' as const, error, agent: name };
          }

          const durationMs = Date.now() - agentStart;
          yield { type: 'agent-end' as const, agent: name, output: agentText, durationMs };

          finalText = agentText;
          currentPrompt = `Original task: ${prompt}\n\nPrevious agent (${name}) output:\n${agentText}`;
        }

        const totalDurationMs = Date.now() - startMs;
        yield {
          type: 'agent-end' as const,
          agent: '__agency__',
          output: finalText,
          durationMs: totalDurationMs,
        };
      }

      /*
       * Because an `AsyncGenerator` can only be iterated once, we materialise
       * a single generator and share it between `fullStream`, `textStream`,
       * `text`, and `usage` by buffering all events.
       */
      const buffered: AgencyStreamPart[] = [];
      let generatorDone = false;
      let generatorPromise: Promise<void> | null = null;

      /** Drain the generator into the buffer exactly once. */
      function ensureDraining(): Promise<void> {
        if (!generatorPromise) {
          generatorPromise = (async () => {
            const gen = streamGenerator();
            for await (const part of gen) {
              buffered.push(part);
            }
            generatorDone = true;
          })();
        }
        return generatorPromise;
      }

      /** Async iterable over all stream parts (full event stream). */
      async function* fullStreamIterable(): AsyncGenerator<AgencyStreamPart> {
        await ensureDraining();
        for (const part of buffered) {
          yield part;
        }
      }

      /** Async iterable over text-only parts. */
      async function* textStreamIterable(): AsyncGenerator<string> {
        await ensureDraining();
        for (const part of buffered) {
          if (part.type === 'text') {
            yield part.text;
          }
        }
      }

      /** Resolves with the concatenated final text. */
      const textPromise: Promise<string> = ensureDraining().then(() =>
        buffered
          .filter((p): p is { type: 'text'; text: string; agent?: string } => p.type === 'text')
          .map((p) => p.text)
          .join(''),
      );

      /** Resolves with stub usage totals (full accounting is in execute()). */
      const usagePromise: Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> =
        Promise.resolve({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });

      void self; // suppress unused-var warning (self referenced for future use)

      return {
        textStream: textStreamIterable(),
        fullStream: fullStreamIterable(),
        text: textPromise,
        usage: usagePromise,
        toolCalls: Promise.resolve([]),
      };
    },
  };
}
