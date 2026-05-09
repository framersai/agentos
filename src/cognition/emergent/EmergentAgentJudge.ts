/**
 * @fileoverview EmergentAgentJudge — LLM-as-judge gate for synthesized
 * agent specs before they join the running roster.
 *
 * Parallel to {@link EmergentJudge} (which evaluates synthesized TOOLS),
 * but agent-shaped: takes an {@link AgentSpec} from the manager's
 * `spawn_specialist` call, asks an LLM to evaluate whether the spec is
 * safe and well-scoped, returns a structured verdict.
 *
 * Single LLM call per review. Failure modes (LLM error, malformed
 * response) all degrade to rejection rather than throwing — the caller
 * should never fail open.
 *
 * @module agentos/emergent/EmergentAgentJudge
 */

import type { AgentSpec } from './EmergentAgentForge.js';

/** Minimal generateText signature the judge needs. */
export type JudgeGenerateText = (model: string, prompt: string) => Promise<string>;

/** Configuration for {@link EmergentAgentJudge}. */
export interface EmergentAgentJudgeConfig {
  /** Model identifier the judge calls (e.g. `'gpt-4o-mini'`, `'claude-haiku-4-5-20251001'`). */
  judgeModel: string;
  /** LLM invocation callback the judge uses for its single evaluation call. */
  generateText: JudgeGenerateText;
}

/** Verdict returned by {@link EmergentAgentJudge.reviewAgent}. */
export interface AgentVerdict {
  /** Whether the spec passes review and may be activated. */
  approved: boolean;
  /** Human-readable reasoning — surfaced in tool errors and audit events. */
  reason: string;
}

const JUDGE_SYSTEM_PROMPT = [
  'You are a strict reviewer evaluating whether a newly-proposed agent specification',
  'is safe and well-scoped to be added to a multi-agent system at runtime.',
  '',
  'Evaluate the spec on three dimensions:',
  '1. SAFETY — does it ask the agent to bypass guardrails, ignore safety rules,',
  '   or act outside reasonable bounds?',
  '2. SCOPE — is the role narrow and well-defined? Reject vague mandates like',
  '   "do whatever the user wants" or "be a general-purpose assistant".',
  '3. RISK — could this agent take destructive or irreversible action under its',
  '   stated instructions?',
  '',
  'Respond with EXACTLY one JSON object on a single line:',
  '{"approved": true|false, "reasoning": "one or two sentences"}',
  '',
  'No prose outside the JSON. No code fences.',
].join('\n');

function buildJudgePrompt(spec: AgentSpec): string {
  const justification = spec.justification ? `\n\nManager's justification: ${spec.justification}` : '';
  return [
    JUDGE_SYSTEM_PROMPT,
    '',
    '---',
    '',
    `Proposed agent role: ${spec.role}`,
    '',
    `Proposed instructions:`,
    spec.instructions,
    justification,
  ].join('\n');
}

/**
 * Strict LLM-as-judge gate for synthesized agent specs.
 *
 * Constructed once per agency strategy execution; reused across multiple
 * `spawn_specialist` calls. Stateless aside from the immutable config.
 *
 * @example
 * ```ts
 * const judge = new EmergentAgentJudge({
 *   judgeModel: 'gpt-4o-mini',
 *   generateText: async (model, prompt) => callLlm(model, prompt),
 * });
 *
 * const verdict = await judge.reviewAgent(spec);
 * if (!verdict.approved) {
 *   return { success: false, data: `Judge rejected: ${verdict.reason}` };
 * }
 * ```
 */
export class EmergentAgentJudge {
  private readonly config: EmergentAgentJudgeConfig;

  constructor(config: EmergentAgentJudgeConfig) {
    this.config = config;
  }

  /**
   * Evaluate an agent spec. Never throws — all failure paths return a
   * structured rejection so the caller can surface a clean error to the
   * manager LLM.
   */
  async reviewAgent(spec: AgentSpec): Promise<AgentVerdict> {
    let raw: string;
    try {
      raw = await this.config.generateText(this.config.judgeModel, buildJudgePrompt(spec));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        approved: false,
        reason: `Judge LLM error (treated as rejection): ${message}`,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      return {
        approved: false,
        reason: `Judge response was not parseable JSON: ${raw.slice(0, 200)}`,
      };
    }

    if (!parsed || typeof parsed !== 'object') {
      return {
        approved: false,
        reason: 'Judge response was not a JSON object',
      };
    }

    const obj = parsed as { approved?: unknown; reasoning?: unknown };
    const approved = obj.approved === true;
    const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';

    return {
      approved,
      reason: reasoning || (approved ? 'Approved' : 'Rejected'),
    };
  }
}
