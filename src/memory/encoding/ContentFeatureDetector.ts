/**
 * @fileoverview Content feature detection for memory encoding.
 *
 * Three strategies (configurable per-agent):
 * - `keyword`  — fast regex/lexicon-based heuristics (zero latency, no LLM cost)
 * - `llm`      — cheap LLM call for accurate classification
 * - `hybrid`   — keywords in real-time, LLM retroactively during consolidation
 *
 * @module agentos/memory/encoding/ContentFeatureDetector
 */

import type { ContentFeatures } from '../types.js';

// ---------------------------------------------------------------------------
// Strategy interface
// ---------------------------------------------------------------------------

export interface IContentFeatureDetector {
  detect(text: string): Promise<ContentFeatures>;
}

// ---------------------------------------------------------------------------
// Keyword patterns
// ---------------------------------------------------------------------------

const PROCEDURE_PATTERNS = [
  /\bstep[\s-]?\d/i,
  /\bfirst[\s,]/i,
  /\bthen[\s,]/i,
  /\bfinally[\s,]/i,
  /\binstructions?\b/i,
  /\bhow[\s-]to\b/i,
  /\bprocedure\b/i,
  /\brecipe\b/i,
  /\bworkflow\b/i,
  /\b\d+\.\s+\w/,  // numbered lists
];

const EMOTION_PATTERNS = [
  /\bhappy\b|\bsad\b|\bangry\b|\bfrustrat/i,
  /\bexcit/i, /\bworri/i, /\banxious\b/i,
  /\blove\b|\bhate\b|\bfear\b/i,
  /\bthank/i, /\bsorry\b/i, /\bgrateful\b/i,
  /\bdisappoint/i, /\bdeligh/i, /\bupset\b/i,
  /[!]{2,}/, /[😀-🙏🤣😂❤️😍😊🥺😭😘🤔😅😩🥰😡💀]/u,
];

const SOCIAL_PATTERNS = [
  /\bteam\b|\bcolleague\b|\bmanager\b/i,
  /\bmeeting\b|\bcall\b|\bdiscuss/i,
  /\bfriend\b|\bfamily\b|\bpartner\b/i,
  /\bhe\s+(said|told|asked)\b/i,
  /\bshe\s+(said|told|asked)\b/i,
  /\bthey\s+(said|told|asked)\b/i,
];

const COOPERATION_PATTERNS = [
  /\btogether\b|\bcollaborat/i,
  /\bagree\b|\bconsensus\b/i,
  /\bhelp\b|\bassist\b|\bsupport\b/i,
  /\bshare\b|\bcontribut/i,
  /\bcompromis/i,
];

const ETHICAL_PATTERNS = [
  /\bfair\b|\bunfair\b|\bjust\b|\bunjust\b/i,
  /\bright\b.*\bwrong\b|\bwrong\b.*\bright\b/i,
  /\bethic/i, /\bmoral/i, /\bhonest/i,
  /\bprivacy\b|\bconsent\b|\btranspar/i,
  /\bresponsib/i, /\baccountab/i,
];

const CONTRADICTION_PATTERNS = [
  /\bactually\b.*\bnot\b/i,
  /\bthat'?s\s+(wrong|incorrect|false)\b/i,
  /\bcorrect(ion|ed)\b/i,
  /\bcontrad/i,
  /\bhowever\b.*\b(not|isn'?t|wasn'?t|doesn'?t)\b/i,
  /\bin\s+fact\b/i,
  /\bmistak/i,
  /\bno,\s/i,
];

const NOVELTY_PATTERNS = [
  /\bnew\b|\bnovel\b|\bunexpect/i,
  /\bsurpris/i, /\bfirst\s+time\b/i,
  /\bnever\s+(seen|heard|done)\b/i,
  /\bdiscover/i, /\bbreakthrough\b/i,
  /\binnovati/i, /\bunique\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

// ---------------------------------------------------------------------------
// Keyword-based detector
// ---------------------------------------------------------------------------

export class KeywordFeatureDetector implements IContentFeatureDetector {
  async detect(text: string): Promise<ContentFeatures> {
    return {
      hasNovelty: matchesAny(text, NOVELTY_PATTERNS),
      hasProcedure: matchesAny(text, PROCEDURE_PATTERNS),
      hasEmotion: matchesAny(text, EMOTION_PATTERNS),
      hasSocialContent: matchesAny(text, SOCIAL_PATTERNS),
      hasCooperation: matchesAny(text, COOPERATION_PATTERNS),
      hasEthicalContent: matchesAny(text, ETHICAL_PATTERNS),
      hasContradiction: matchesAny(text, CONTRADICTION_PATTERNS),
      topicRelevance: 0.5, // keywords can't assess task relevance
    };
  }
}

// ---------------------------------------------------------------------------
// LLM-based detector
// ---------------------------------------------------------------------------

const LLM_SYSTEM_PROMPT = `You are a content feature classifier. Given text, output a JSON object with exactly these boolean fields and one number field:
{
  "hasNovelty": bool,
  "hasProcedure": bool,
  "hasEmotion": bool,
  "hasSocialContent": bool,
  "hasCooperation": bool,
  "hasEthicalContent": bool,
  "hasContradiction": bool,
  "topicRelevance": number (0-1)
}
Respond ONLY with the JSON object, no explanation.`;

export class LlmFeatureDetector implements IContentFeatureDetector {
  constructor(
    private llmInvoker: (system: string, user: string) => Promise<string>,
  ) {}

  async detect(text: string): Promise<ContentFeatures> {
    try {
      const response = await this.llmInvoker(LLM_SYSTEM_PROMPT, text);
      const parsed = JSON.parse(response.trim());
      return {
        hasNovelty: !!parsed.hasNovelty,
        hasProcedure: !!parsed.hasProcedure,
        hasEmotion: !!parsed.hasEmotion,
        hasSocialContent: !!parsed.hasSocialContent,
        hasCooperation: !!parsed.hasCooperation,
        hasEthicalContent: !!parsed.hasEthicalContent,
        hasContradiction: !!parsed.hasContradiction,
        topicRelevance: typeof parsed.topicRelevance === 'number'
          ? Math.max(0, Math.min(1, parsed.topicRelevance))
          : 0.5,
      };
    } catch {
      // Fallback to keyword detection on LLM failure
      return new KeywordFeatureDetector().detect(text);
    }
  }
}

// ---------------------------------------------------------------------------
// Hybrid detector (keyword real-time, LLM deferred)
// ---------------------------------------------------------------------------

/**
 * Uses keyword detection for real-time encoding. Exposes `detectWithLlm()`
 * for retroactive re-classification during consolidation.
 */
export class HybridFeatureDetector implements IContentFeatureDetector {
  private keyword = new KeywordFeatureDetector();
  private llm: LlmFeatureDetector | null;

  constructor(llmInvoker?: (system: string, user: string) => Promise<string>) {
    this.llm = llmInvoker ? new LlmFeatureDetector(llmInvoker) : null;
  }

  /** Real-time detection: keyword only (zero latency). */
  async detect(text: string): Promise<ContentFeatures> {
    return this.keyword.detect(text);
  }

  /** Deferred detection: LLM-based (called during consolidation). */
  async detectWithLlm(text: string): Promise<ContentFeatures> {
    if (this.llm) {
      return this.llm.detect(text);
    }
    return this.keyword.detect(text);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFeatureDetector(
  strategy: 'keyword' | 'llm' | 'hybrid',
  llmInvoker?: (system: string, user: string) => Promise<string>,
): IContentFeatureDetector {
  switch (strategy) {
    case 'llm':
      if (!llmInvoker) {
        throw new Error('LLM feature detection requires an llmInvoker function');
      }
      return new LlmFeatureDetector(llmInvoker);
    case 'hybrid':
      return new HybridFeatureDetector(llmInvoker);
    case 'keyword':
    default:
      return new KeywordFeatureDetector();
  }
}
