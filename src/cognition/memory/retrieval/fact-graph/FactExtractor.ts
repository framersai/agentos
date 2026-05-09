/**
 * @file FactExtractor.ts
 * @description LLM-driven fact extraction. Turns a session's turns into
 * `Fact[]` using the closed 25-predicate schema and literal-object
 * preservation contract (see Step 9 design spec §4.3).
 *
 * Cache: in-memory keyed by SHA-256(fingerprint | session-content). At
 * LongMemEval-S scale (~50 sessions per case, many shared across cases)
 * this amortizes to ~4 LLM calls per case after warmup. Fingerprint
 * bump (`:v1` → `:v2`) invalidates the cache for prompt/schema
 * iterations.
 *
 * @module agentos/memory/retrieval/fact-graph/FactExtractor
 */

import { createHash } from 'node:crypto';
import type { Fact } from './types.js';
import { isValidPredicate } from './canonicalization.js';

export interface FactExtractorSession {
  sessionId: string;
  /** ISO date — used as the fact timestamp. */
  date: string;
  turns: readonly { role: 'user' | 'assistant' | 'system' | 'tool'; content: string }[];
}

export interface FactExtractorOptions {
  /** Called with (systemPrompt, userPrompt). Must return the model's text response. */
  llmInvoker: (systemPrompt: string, userPrompt: string) => Promise<string>;
  /**
   * Fingerprint appended to the content hash for cache keying. Bump
   * when the prompt or schema changes so prior-version extractions
   * don't leak into new runs.
   */
  cacheFingerprint: string;
  /** Hard cap on LLM output tokens. Default 1024. */
  maxOutputTokens?: number;
}

const SYSTEM_PROMPT = `You extract structured facts from conversation turns.

Output JSON: an array of {subject, predicate, object, sourceSpan} objects.

Rules:
1. subject is a canonical entity (person name, organization, "user" for first-person).
2. predicate MUST be one of: prefers, dislikes, avoids, is, isNamed, identifiesAs,
   livesIn, worksAt, studiesAt, ownsPet, drives, marriedTo, parentOf, friendOf,
   colleagueOf, visited, attended, purchased, scheduled, allergicTo,
   takesMedication, diagnosedWith, commitsTo, decidedOn, believes.
   Skip facts that don't fit these predicates — do not invent new ones.
3. object MUST be a literal span from the turn. Copy the exact words the
   speaker used. Do NOT paraphrase, generalize, or shorten.
4. sourceSpan is the full sentence the fact was extracted from.
5. If a turn contains no extractable fact, output an empty array for that turn.
6. Return only the JSON array. No prose.`;

export class FactExtractor {
  private readonly cache = new Map<string, Fact[]>();
  private readonly llmInvoker: FactExtractorOptions['llmInvoker'];
  private readonly fingerprint: string;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private readonly maxOutputTokens: number;

  constructor(opts: FactExtractorOptions) {
    this.llmInvoker = opts.llmInvoker;
    this.fingerprint = opts.cacheFingerprint;
    this.maxOutputTokens = opts.maxOutputTokens ?? 1024;
  }

  async extract(session: FactExtractorSession): Promise<Fact[]> {
    const hash = this.hashSession(session);
    const cached = this.cache.get(hash);
    if (cached) return cached;

    const userPrompt = this.buildUserPrompt(session);
    const raw = await this.llmInvoker(SYSTEM_PROMPT, userPrompt);

    const parsed = this.parseResponse(raw, session);
    this.cache.set(hash, parsed);
    return parsed;
  }

  private hashSession(session: FactExtractorSession): string {
    const content = session.turns.map((t) => `${t.role}:${t.content}`).join('\n');
    return createHash('sha256').update(`${this.fingerprint}|${content}`).digest('hex');
  }

  private buildUserPrompt(session: FactExtractorSession): string {
    return [
      `Session ${session.sessionId} dated ${session.date}:`,
      '',
      ...session.turns.map((t) => `${t.role}: ${t.content}`),
      '',
      'Extract facts as specified. Return only the JSON array.',
    ].join('\n');
  }

  private parseResponse(raw: string, session: FactExtractorSession): Fact[] {
    let payload: unknown;
    try {
      // Accept bare JSON arrays and code-fenced versions.
      const cleaned = raw
        .trim()
        .replace(/^```(?:json)?/, '')
        .replace(/```$/, '')
        .trim();
      payload = JSON.parse(cleaned);
    } catch {
      return [];
    }
    if (!Array.isArray(payload)) return [];

    const parsedTs = Date.parse(session.date);
    const safeTs = Number.isFinite(parsedTs) ? parsedTs : Date.now();
    const out: Fact[] = [];
    for (const item of payload) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const subject = typeof rec.subject === 'string' ? rec.subject : null;
      const predicate = typeof rec.predicate === 'string' ? rec.predicate : null;
      const object = typeof rec.object === 'string' ? rec.object : null;
      const sourceSpan = typeof rec.sourceSpan === 'string' ? rec.sourceSpan : null;
      if (!subject || !predicate || !object || !sourceSpan) continue;
      if (!isValidPredicate(predicate)) continue;
      out.push({
        subject,
        predicate,
        object,
        timestamp: safeTs,
        sourceTraceIds: [session.sessionId],
        sourceSpan,
      });
    }
    return out;
  }
}
