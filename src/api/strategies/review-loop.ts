/**
 * @file review-loop.ts
 * Review-loop strategy compiler for the Agency API.
 *
 * The first agent (producer) creates or revises work, the second agent
 * (reviewer) evaluates it. The loop continues until the reviewer approves
 * or `maxRounds` is exhausted. Additional agents beyond the first two are
 * reserved for future specialist injection.
 */
import { agent as createAgent } from '../agent.js';
import type {
  AgencyOptions,
  CompiledStrategy,
  Agent,
  BaseAgentConfig,
  AgentCallRecord,
} from '../types.js';
import { AgencyConfigError } from '../types.js';
import { isAgent } from './index.js';

/**
 * Merge agency-level defaults into an agent config.
 *
 * Agent-level values take precedence; tools are merged (agency tools serve as
 * a base layer, agent tools override on name collision).
 *
 * @param agentConfig - Per-agent configuration.
 * @param agencyConfig - Agency-level fallback values.
 * @returns A merged config suitable for passing to `agent()`.
 */
function mergeDefaults(
  agentConfig: BaseAgentConfig,
  agencyConfig: AgencyOptions,
): BaseAgentConfig {
  return {
    model: agentConfig.model ?? agencyConfig.model,
    provider: agentConfig.provider ?? agencyConfig.provider,
    apiKey: agentConfig.apiKey ?? agencyConfig.apiKey,
    baseUrl: agentConfig.baseUrl ?? agencyConfig.baseUrl,
    ...agentConfig,
    /* Merge tool maps: agency tools as base, agent tools overlay. */
    tools: { ...(agencyConfig.tools ?? {}), ...(agentConfig.tools ?? {}) },
  };
}

/**
 * Resolves an agent-or-config value into a usable {@link Agent} instance.
 *
 * @param agentOrConfig - Either a pre-built Agent or a raw BaseAgentConfig.
 * @param agencyConfig - Agency-level fallback values for config merging.
 * @returns A ready-to-call Agent instance.
 */
function resolveAgent(
  agentOrConfig: BaseAgentConfig | Agent,
  agencyConfig: AgencyOptions,
): Agent {
  return isAgent(agentOrConfig)
    ? agentOrConfig
    : createAgent({ ...mergeDefaults(agentOrConfig, agencyConfig) });
}

/**
 * Attempts to parse a reviewer response as JSON with an `approved` field.
 *
 * The reviewer is instructed to respond with `{ "approved": true/false, "feedback": "..." }`.
 * When the response is not valid JSON, or lacks an `approved` boolean, the entire
 * text is treated as feedback and the draft is considered not approved.
 *
 * @param text - Raw reviewer output text.
 * @returns Parsed review with approval status and feedback string.
 */
function parseReview(text: string): { approved: boolean; feedback: string } {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.approved === 'boolean') {
      return {
        approved: parsed.approved,
        feedback: (parsed.feedback as string) ?? text,
      };
    }
  } catch {
    /* Not valid JSON — fall through to treat entire text as feedback. */
  }
  return { approved: false, feedback: text };
}

/**
 * Compiles a review-loop execution strategy.
 *
 * The first declared agent acts as the producer, the second as the reviewer.
 * The producer generates or revises a draft, then the reviewer evaluates it.
 * If the reviewer approves (responds with `{ "approved": true }`), the loop
 * terminates early. Otherwise the reviewer's feedback is fed back into the
 * producer for revision, up to `maxRounds` iterations.
 *
 * @param agents - Named roster of agent configs or pre-built `Agent` instances.
 *   At least two agents are required (producer + reviewer).
 * @param agencyConfig - Agency-level configuration providing fallback model/provider/tools.
 * @returns A {@link CompiledStrategy} with `execute` and `stream` methods.
 * @throws {AgencyConfigError} When fewer than two agents are provided.
 */
export function compileReviewLoop(
  agents: Record<string, BaseAgentConfig | Agent>,
  agencyConfig: AgencyOptions,
): CompiledStrategy {
  const entries = Object.entries(agents);
  if (entries.length < 2) {
    throw new AgencyConfigError(
      'Review-loop strategy requires at least two agents (producer + reviewer).',
    );
  }

  const maxRounds = agencyConfig.maxRounds ?? 3;
  const [producerName, producerConfig] = entries[0];
  const [reviewerName, reviewerConfig] = entries[1];

  return {
    async execute(prompt, opts) {
      const agentCalls: AgentCallRecord[] = [];
      const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      const producer = resolveAgent(producerConfig, agencyConfig);
      const reviewer = resolveAgent(reviewerConfig, agencyConfig);

      let draft = '';
      let feedback = '';

      for (let round = 0; round < maxRounds; round++) {
        /* ---- Producer creates or revises ---- */
        const prodPrompt =
          round === 0
            ? prompt
            : `${prompt}\n\nYour previous draft:\n${draft}\n\nReviewer feedback:\n${feedback}\n\nRevise your work.`;

        const prodStart = Date.now();
        const prodResult = (await producer.generate(prodPrompt, opts)) as Record<string, unknown>;
        const prodDuration = Date.now() - prodStart;

        const prodText = (prodResult.text as string) ?? '';
        const prodUsage = (prodResult.usage as { promptTokens?: number; completionTokens?: number; totalTokens?: number }) ?? {};
        const prodToolCalls = (prodResult.toolCalls as Array<{ name: string; args: unknown; result?: unknown; error?: string }>) ?? [];

        draft = prodText;

        agentCalls.push({
          agent: producerName,
          input: prodPrompt,
          output: prodText,
          toolCalls: prodToolCalls,
          usage: {
            promptTokens: prodUsage.promptTokens ?? 0,
            completionTokens: prodUsage.completionTokens ?? 0,
            totalTokens: prodUsage.totalTokens ?? 0,
          },
          durationMs: prodDuration,
        });

        totalUsage.promptTokens += prodUsage.promptTokens ?? 0;
        totalUsage.completionTokens += prodUsage.completionTokens ?? 0;
        totalUsage.totalTokens += prodUsage.totalTokens ?? 0;

        /* ---- Reviewer evaluates ---- */
        const revPrompt =
          `Review this work for the task: "${prompt}"\n\n` +
          `Draft:\n${draft}\n\n` +
          `Respond with JSON: { "approved": true/false, "feedback": "..." }`;

        const revStart = Date.now();
        const revResult = (await reviewer.generate(revPrompt, opts)) as Record<string, unknown>;
        const revDuration = Date.now() - revStart;

        const revText = (revResult.text as string) ?? '';
        const revUsage = (revResult.usage as { promptTokens?: number; completionTokens?: number; totalTokens?: number }) ?? {};
        const revToolCalls = (revResult.toolCalls as Array<{ name: string; args: unknown; result?: unknown; error?: string }>) ?? [];

        agentCalls.push({
          agent: reviewerName,
          input: revPrompt,
          output: revText,
          toolCalls: revToolCalls,
          usage: {
            promptTokens: revUsage.promptTokens ?? 0,
            completionTokens: revUsage.completionTokens ?? 0,
            totalTokens: revUsage.totalTokens ?? 0,
          },
          durationMs: revDuration,
        });

        totalUsage.promptTokens += revUsage.promptTokens ?? 0;
        totalUsage.completionTokens += revUsage.completionTokens ?? 0;
        totalUsage.totalTokens += revUsage.totalTokens ?? 0;

        /* Parse the review decision. */
        const review = parseReview(revText);
        if (review.approved) break;
        feedback = review.feedback;
      }

      return { text: draft, agentCalls, usage: totalUsage };
    },

    stream(prompt, opts) {
      /*
       * For v1: streaming delegates to execute() and wraps the resolved text
       * as a single-chunk async iterable. A future version will stream the
       * producer's output in real-time during the final round.
       */
      const resultPromise = this.execute(prompt, opts) as Promise<Record<string, unknown>>;
      const textPromise = resultPromise.then((r) => (r.text as string) ?? '');

      return {
        textStream: (async function* () {
          yield await textPromise;
        })(),
        fullStream: (async function* () {
          const text = await textPromise;
          yield { type: 'text' as const, text };
        })(),
        text: textPromise,
        usage: resultPromise.then((r) => r.usage),
      };
    },
  };
}
