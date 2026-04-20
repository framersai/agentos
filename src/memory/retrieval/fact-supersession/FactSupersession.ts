/**
 * @file FactSupersession.ts
 * @description Post-retrieval filter that uses an LLM to identify and
 * drop memory traces whose factual claims have been superseded by
 * later traces about the same subject.
 *
 * ## What this does
 *
 * Given a query and a list of retrieved `ScoredMemoryTrace`s, fires
 * one LLM call with a strict JSON output contract. The LLM returns
 * `{ dropIds: string[] }` — trace IDs to remove. The class filters
 * the input list and returns the survivors in original order.
 *
 * ## Failure modes (never throws)
 *
 * - Parse error → return original traces + `parse-failed` diagnostic.
 * - Schema mismatch → return original + `schema-mismatch` diagnostic.
 * - Timeout → return original + `timeout` diagnostic.
 * - LLM throws → return original + `llm-error` diagnostic.
 * - All IDs dropped (adversarial output) → safety clamp, return
 *   original + `drop-all-rejected` diagnostic.
 *
 * ## Why this exists
 *
 * The baseline + Hybrid retrieval surfaces BOTH statements when a
 * user has updated a fact ("I live in NYC" + "I moved to Berlin").
 * The reader sometimes picks the older or hedges. A supersession
 * pass gives the reader only the canonical current state.
 *
 * @module agentos/memory/retrieval/fact-supersession/FactSupersession
 */

import type { ScoredMemoryTrace } from '../../core/types.js';

export type LlmInvoker = (systemPrompt: string, userPrompt: string) => Promise<string>;

/** Options for constructing a {@link FactSupersession}. */
export interface FactSupersessionOptions {
  /** LLM invoker used for the supersession pass. */
  llmInvoker: LlmInvoker;
  /** Max traces to send to the LLM. @default 10 */
  maxTraces?: number;
  /** Max wall-clock ms before timeout fallback. @default 8000 */
  timeoutMs?: number;
}

/** Per-call input to {@link FactSupersession.resolve}. */
export interface FactSupersessionInput {
  traces: ScoredMemoryTrace[];
  query: string;
}

/** Per-call output from {@link FactSupersession.resolve}. */
export interface FactSupersessionResult {
  /** Traces surviving the filter, in original order. */
  traces: ScoredMemoryTrace[];
  /** IDs dropped by the LLM (subset of input trace IDs). */
  droppedIds: string[];
  diagnostics: {
    llmLatencyMs: number;
    parseOk: boolean;
    notes?: string[];
  };
}

/**
 * Canonical supersession system prompt. Strict rules: supersession
 * requires contradiction between two claims about the same (subject,
 * predicate); complementary facts never supersede.
 */
const SUPERSESSION_SYSTEM_PROMPT = `You are a fact-supersession analyzer for memory retrieval. Given a user question and N retrieved memory traces, identify traces containing FACTS that have been SUPERSEDED by later traces about the same subject.

Rules:
1. Supersession requires contradiction — two traces making DIFFERENT claims about the same (subject, predicate).
2. Use the timestamp field to order claims chronologically. The LATER trace wins.
3. Traces about DIFFERENT subjects are never mutually superseding.
4. Complementary facts (different predicates about the same subject) never supersede each other.
5. Return a JSON object: {"dropIds": ["id1", "id2"]}. Drop ONLY the outdated ones. Return {"dropIds": []} if no supersession detected.

Do not drop traces that are not clearly superseded.`;

/**
 * Post-retrieval fact supersession filter.
 *
 * @example
 * ```ts
 * const fs = new FactSupersession({
 *   llmInvoker: async (system, user) => (await reader.invoke({ system, user, maxTokens: 200, temperature: 0 })).text,
 * });
 * const result = await fs.resolve({ traces: retrieval.retrieved, query: caseQuery });
 * // Feed `result.traces` to the reader instead of `retrieval.retrieved`.
 * ```
 */
export class FactSupersession {
  private readonly llmInvoker: LlmInvoker;
  private readonly maxTraces: number;
  private readonly timeoutMs: number;

  constructor(opts: FactSupersessionOptions) {
    this.llmInvoker = opts.llmInvoker;
    this.maxTraces = opts.maxTraces ?? 10;
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  async resolve(input: FactSupersessionInput): Promise<FactSupersessionResult> {
    const start = Date.now();
    const notes: string[] = [];

    if (input.traces.length === 0) {
      return {
        traces: [],
        droppedIds: [],
        diagnostics: { llmLatencyMs: 0, parseOk: true },
      };
    }

    const window = input.traces.slice(0, this.maxTraces);
    const userPrompt = this.buildUserPrompt(input.query, window);

    let llmText: string;
    try {
      llmText = await this.invokeWithTimeout(userPrompt);
    } catch (err) {
      const reason = (err as Error)?.message?.includes('timeout')
        ? 'fact-supersession:timeout'
        : 'fact-supersession:llm-error';
      notes.push(reason);
      return {
        traces: input.traces,
        droppedIds: [],
        diagnostics: { llmLatencyMs: Date.now() - start, parseOk: false, notes },
      };
    }

    const parsed = this.parseDropIds(llmText);
    if (!parsed.ok) {
      notes.push(parsed.reason);
      return {
        traces: input.traces,
        droppedIds: [],
        diagnostics: { llmLatencyMs: Date.now() - start, parseOk: false, notes },
      };
    }

    if (parsed.dropIds.length >= input.traces.length) {
      notes.push('fact-supersession:drop-all-rejected');
      return {
        traces: input.traces,
        droppedIds: [],
        diagnostics: { llmLatencyMs: Date.now() - start, parseOk: true, notes },
      };
    }

    const dropSet = new Set(parsed.dropIds);
    const filtered = input.traces.filter((t) => !dropSet.has(t.id));
    const realDropped = input.traces
      .filter((t) => dropSet.has(t.id))
      .map((t) => t.id);

    return {
      traces: filtered,
      droppedIds: realDropped,
      diagnostics: {
        llmLatencyMs: Date.now() - start,
        parseOk: true,
        notes: notes.length > 0 ? notes : undefined,
      },
    };
  }

  private buildUserPrompt(query: string, traces: ScoredMemoryTrace[]): string {
    const lines = traces.map((t) => {
      const ts = new Date(t.createdAt).toISOString();
      const content = t.content.length > 500 ? `${t.content.slice(0, 500)}...` : t.content;
      return `[id=${t.id} | ts=${ts} | "${content}"]`;
    });
    return `Question: ${query}\n\nTraces (id | timestamp | content):\n${lines.join('\n')}\n\nReturn JSON only.`;
  }

  private async invokeWithTimeout(userPrompt: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fact-supersession timeout')), this.timeoutMs);
      this.llmInvoker(SUPERSESSION_SYSTEM_PROMPT, userPrompt)
        .then((text) => { clearTimeout(timer); resolve(text); })
        .catch((err) => { clearTimeout(timer); reject(err); });
    });
  }

  private parseDropIds(text: string):
    | { ok: true; dropIds: string[] }
    | { ok: false; reason: string } {
    const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    let obj: unknown;
    try {
      obj = JSON.parse(cleaned);
    } catch {
      return { ok: false, reason: 'fact-supersession:parse-failed' };
    }
    if (!obj || typeof obj !== 'object' || !Array.isArray((obj as { dropIds?: unknown }).dropIds)) {
      return { ok: false, reason: 'fact-supersession:schema-mismatch' };
    }
    const arr = (obj as { dropIds: unknown[] }).dropIds;
    if (!arr.every((v) => typeof v === 'string')) {
      return { ok: false, reason: 'fact-supersession:schema-mismatch' };
    }
    return { ok: true, dropIds: arr as string[] };
  }
}
