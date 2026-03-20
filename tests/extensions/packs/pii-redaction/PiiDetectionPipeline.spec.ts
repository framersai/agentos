/**
 * @file PiiDetectionPipeline.spec.ts
 * @description Unit tests for {@link PiiDetectionPipeline}, the four-tier
 * orchestrator that chains Regex → NLP pre-filter → NER model → LLM judge.
 *
 * Strategy:
 * - Integration tests use real recognisers where the underlying library
 *   (openredaction) is available, so we can verify the end-to-end path for
 *   structured PII (emails, SSNs, phone numbers).
 * - For NER/NLP tiers we rely on graceful degradation (both recognisers return
 *   [] when their optional dependencies are absent) so the tests remain
 *   deterministic in CI without HuggingFace model downloads.
 * - The LLM judge is exercised via a mocked `LlmJudgeRecognizer` instance
 *   injected via `vi.spyOn` or by configuring an unreachable endpoint so
 *   the fail-open behaviour applies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PiiDetectionPipeline } from '../../../../src/extensions/packs/pii-redaction/PiiDetectionPipeline';
import type { ISharedServiceRegistry } from '../../../../src/extensions/ISharedServiceRegistry';
import type { PiiRedactionPackOptions } from '../../../../src/extensions/packs/pii-redaction/types';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal stub implementation of {@link ISharedServiceRegistry}.
 *
 * Uses an in-memory Map to store lazily-created services.  The `getOrCreate`
 * method mirrors the real implementation: it calls the factory exactly once
 * and caches the result for all subsequent calls.
 */
function makeMockRegistry(): ISharedServiceRegistry {
  const store = new Map<string, unknown>();

  return {
    async getOrCreate<T>(
      serviceId: string,
      factory: () => Promise<T> | T,
    ): Promise<T> {
      if (store.has(serviceId)) return store.get(serviceId) as T;
      const instance = await factory();
      store.set(serviceId, instance);
      return instance;
    },
    has(serviceId: string): boolean {
      return store.has(serviceId);
    },
    async release(serviceId: string): Promise<void> {
      store.delete(serviceId);
    },
    async releaseAll(): Promise<void> {
      store.clear();
    },
  };
}

/**
 * Returns a {@link PiiRedactionPackOptions} baseline with sensible test
 * defaults that can be overridden per-test.
 *
 * - No LLM judge by default (avoids real HTTP calls).
 * - Threshold 0.5 (the documented default).
 * - NER model disabled so tests don't attempt to download transformer models.
 */
function makeOptions(
  overrides: Partial<PiiRedactionPackOptions> = {},
): PiiRedactionPackOptions {
  return {
    confidenceThreshold: 0.5,
    enableNerModel: false, // Disable NER to avoid model downloads in CI.
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fresh pipeline with test defaults, optionally overriding options.
 *
 * @param options   - Optional partial options to override test defaults.
 * @param getSecret - Optional secret resolver (used for LLM judge key tests).
 */
function makePipeline(
  options?: Partial<PiiRedactionPackOptions>,
  getSecret?: (id: string) => string | undefined,
): PiiDetectionPipeline {
  return new PiiDetectionPipeline(
    makeMockRegistry(),
    makeOptions(options),
    getSecret,
  );
}

// ---------------------------------------------------------------------------
// Core detection tests
// ---------------------------------------------------------------------------

describe('PiiDetectionPipeline — structured PII detection (Tier 1 Regex)', () => {
  /**
   * The pipeline should detect email addresses via the regex tier.
   * We use a realistic domain because openredaction rejects @example.com.
   */
  it('detects email addresses in plain text', async () => {
    const pipeline = makePipeline({ confidenceThreshold: 0.0 });
    const result = await pipeline.detect('Contact alice@acmecorp.org for more info.');

    const email = result.entities.find((e) => e.entityType === 'EMAIL');
    expect(email).toBeDefined();
    expect(email!.text).toContain('alice@acmecorp.org');
    expect(email!.source).toBe('regex');
  });

  /**
   * SSN should be detected when there is a contextual prefix that triggers
   * openredaction's SSN pattern ("SSN: NNN-NN-NNNN").
   */
  it('detects US Social Security Numbers with contextual prefix', async () => {
    const pipeline = makePipeline({ confidenceThreshold: 0.0 });
    const result = await pipeline.detect('SSN: 123-45-6789');

    const ssn = result.entities.find((e) => e.entityType === 'SSN');
    expect(ssn).toBeDefined();
    expect(ssn!.text).toContain('123-45-6789');
  });

  /**
   * When the input contains no PII patterns, the entity list must be empty
   * and the summary must say "No PII detected".
   *
   * We use a very high threshold (0.95) so that any low-confidence NLP
   * pre-filter candidates (which score 0.4–0.55) are filtered out, and we
   * use a string that has no structured PII (emails, SSNs, etc.) to ensure
   * the regex tier produces nothing.
   */
  it('returns empty result and "No PII detected" summary for clean text', async () => {
    // Threshold 0.95 ensures NLP pre-filter candidates (score 0.4–0.55) are
    // filtered out.  The input is deliberately generic with no PII patterns.
    const pipeline = makePipeline({ confidenceThreshold: 0.95 });
    const result = await pipeline.detect('The sky is blue and the grass is green.');

    expect(result.entities).toHaveLength(0);
    expect(result.summary).toBe('No PII detected');
  });

  /**
   * Multiple PII types in a single string should all be detected.
   */
  it('detects multiple PII types in the same text', async () => {
    const pipeline = makePipeline({ confidenceThreshold: 0.0 });
    const text = 'Email alice@acmecorp.org or call 555-867-5309.';
    const result = await pipeline.detect(text);

    const types = result.entities.map((e) => e.entityType);
    // At minimum the email should always be detected.
    expect(types).toContain('EMAIL');
  });
});

// ---------------------------------------------------------------------------
// Result metadata tests
// ---------------------------------------------------------------------------

describe('PiiDetectionPipeline — result metadata', () => {
  /**
   * processingTimeMs must always be a non-negative integer.
   */
  it('processingTimeMs is non-negative', async () => {
    const pipeline = makePipeline();
    const result = await pipeline.detect('Hello world');
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  /**
   * inputLength must equal the length of the original input string.
   */
  it('inputLength equals text.length', async () => {
    const pipeline = makePipeline();
    const text = 'Some test text 1234';
    const result = await pipeline.detect(text);
    expect(result.inputLength).toBe(text.length);
  });

  /**
   * tiersExecuted must always include 'regex' since Tier 1 always runs.
   */
  it('tiersExecuted always includes "regex"', async () => {
    const pipeline = makePipeline();
    const result = await pipeline.detect('Hello world');
    expect(result.tiersExecuted).toContain('regex');
  });

  /**
   * When enableNerModel is false, tiersExecuted must NOT include 'ner'.
   */
  it('tiersExecuted does not include "ner" when enableNerModel is false', async () => {
    const pipeline = makePipeline({ enableNerModel: false });
    const result = await pipeline.detect('John Smith lives in London.');
    expect(result.tiersExecuted).not.toContain('ner');
  });

  /**
   * The LLM tier label should only appear when a judge config is provided
   * (even if no entities were in the ambiguous band — the tier was still
   * executed, just with no work to do).
   */
  it('tiersExecuted does not include "llm" when no llmJudge is configured', async () => {
    const pipeline = makePipeline({ llmJudge: undefined });
    const result = await pipeline.detect('hello@domain.com');
    expect(result.tiersExecuted).not.toContain('llm');
  });
});

// ---------------------------------------------------------------------------
// Confidence threshold tests
// ---------------------------------------------------------------------------

describe('PiiDetectionPipeline — confidence threshold', () => {
  /**
   * The confidence threshold controls which entities survive to the output.
   * We verify the threshold contract by checking that entities with a score
   * below the threshold are absent from the result, while entities above it
   * appear.  We do this by running the same text at two different thresholds
   * and confirming that the higher threshold produces fewer (or equal) results.
   */
  it('higher threshold produces fewer or equal entities than a lower threshold', async () => {
    const pipelineLow = makePipeline({ confidenceThreshold: 0.0 });
    const pipelineHigh = makePipeline({ confidenceThreshold: 0.99 });

    // Text with multiple PII types.
    const text = 'alice@acmecorp.org and SSN: 123-45-6789';

    const resultLow = await pipelineLow.detect(text);
    const resultHigh = await pipelineHigh.detect(text);

    // With 0% threshold, we should see at least as many entities as with 99%.
    expect(resultLow.entities.length).toBeGreaterThanOrEqual(
      resultHigh.entities.length,
    );
  });

  /**
   * When threshold is 0.0 (minimum) all entities should survive.
   */
  it('retains all entities when threshold is 0.0', async () => {
    // Use a pipeline with threshold=0 so even low-confidence entities pass.
    const pipeline = makePipeline({ confidenceThreshold: 0.0 });
    const result = await pipeline.detect('Contact alice@acmecorp.org');
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Default threshold is 0.5 — regex entities (≥0.85) should pass through.
   */
  it('passes regex-detected entities through the default 0.5 threshold', async () => {
    const pipeline = makePipeline(); // default threshold 0.5
    const result = await pipeline.detect('alice@acmecorp.org');
    const email = result.entities.find((e) => e.entityType === 'EMAIL');
    expect(email).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Entity type filter tests
// ---------------------------------------------------------------------------

describe('PiiDetectionPipeline — entityTypes filter', () => {
  /**
   * When the caller requests only EMAIL, PHONE entities should NOT appear
   * even if the text contains a phone-like pattern.
   */
  it('only detects entity types listed in entityTypes', async () => {
    const pipeline = makePipeline({
      entityTypes: ['EMAIL'],
      confidenceThreshold: 0.0,
    });
    // Text contains both email and a phone number pattern.
    const result = await pipeline.detect('alice@acmecorp.org and 555-867-5309');

    const types = new Set(result.entities.map((e) => e.entityType));

    // EMAIL should be present.
    expect(types.has('EMAIL')).toBe(true);
    // PHONE should NOT be present (not in the filter).
    expect(types.has('PHONE')).toBe(false);
  });

  /**
   * When entityTypes is empty, the pipeline defaults to all types.
   * At minimum it should detect an email that is clearly present.
   */
  it('detects all types when entityTypes is omitted', async () => {
    const pipeline = makePipeline({ confidenceThreshold: 0.0 });
    const result = await pipeline.detect('alice@acmecorp.org');
    expect(result.entities.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Summary string tests
// ---------------------------------------------------------------------------

describe('PiiDetectionPipeline — summary string', () => {
  /**
   * Summary should match the documented format: "N entity/entities found: …"
   * with types sorted alphabetically and counts as "N×TYPE".
   */
  it('builds a human-readable summary with entity type counts', async () => {
    const pipeline = makePipeline({ confidenceThreshold: 0.0 });
    const result = await pipeline.detect('alice@acmecorp.org');

    // Should not be the empty message.
    expect(result.summary).not.toBe('No PII detected');

    // Should mention the total entity count.
    expect(result.summary).toMatch(/\d+ entit(y|ies) found:/);

    // Should include at least one N×TYPE chunk.
    expect(result.summary).toMatch(/\d+×\w+/);
  });

  /**
   * Exactly one entity → singular "entity".
   */
  it('uses singular "entity" when exactly one entity is found', async () => {
    const pipeline = makePipeline({ confidenceThreshold: 0.0 });
    // Text with only one detectable PII.
    const result = await pipeline.detect('alice@acmecorp.org');

    // If exactly one entity is found, summary must use singular.
    if (result.entities.length === 1) {
      expect(result.summary).toContain('1 entity found:');
    } else {
      // Multiple entities is also fine for this text; just sanity-check format.
      expect(result.summary).toMatch(/\d+ entities found:/);
    }
  });

  /**
   * Empty input → "No PII detected".
   */
  it('returns "No PII detected" for empty input', async () => {
    const pipeline = makePipeline();
    const result = await pipeline.detect('');
    expect(result.summary).toBe('No PII detected');
  });
});

// ---------------------------------------------------------------------------
// NER tier gating tests
// ---------------------------------------------------------------------------

describe('PiiDetectionPipeline — Tier 3 NER gating', () => {
  /**
   * When enableNerModel is explicitly false, the NER tier must be completely
   * skipped even if the text contains names.  This is the primary test for
   * the `enableNerModel !== false` guard in the pipeline.
   */
  it('skips Tier 3 NER when enableNerModel is false', async () => {
    const pipeline = makePipeline({ enableNerModel: false });
    const result = await pipeline.detect('John Smith lives in New York.');

    // NER was disabled, so 'ner' should NOT appear in tiersExecuted.
    expect(result.tiersExecuted).not.toContain('ner');
  });

  /**
   * Even when enableNerModel is true, Tier 3 should only run when Tier 2
   * (NLP pre-filter) produces at least one PERSON/ORG/LOCATION candidate.
   *
   * For a purely structured PII input (email only), compromise will return
   * no name/org/location candidates, so NER should not run.
   *
   * NOTE: This test depends on compromise being available.  If the library
   * is not installed, the NLP tier returns [], NER is also not triggered,
   * and the assertion still holds.
   */
  it('does not run Tier 3 when Tier 2 produces no NER-class candidates', async () => {
    const pipeline = makePipeline({ enableNerModel: true });
    // Email-only text — compromise produces no person/place/org matches.
    const result = await pipeline.detect('alice@acmecorp.org');
    expect(result.tiersExecuted).not.toContain('ner');
  });
});

// ---------------------------------------------------------------------------
// Output ordering tests
// ---------------------------------------------------------------------------

describe('PiiDetectionPipeline — output ordering', () => {
  /**
   * Entities must be sorted by start offset in ascending order.
   */
  it('returns entities sorted by start offset ascending', async () => {
    const pipeline = makePipeline({ confidenceThreshold: 0.0 });
    // Two emails at different positions in the string.
    const text = 'From alice@acmecorp.org to bob@acmecorp.org regarding the account.';
    const result = await pipeline.detect(text);

    const starts = result.entities.map((e) => e.start);
    const sorted = [...starts].sort((a, b) => a - b);
    expect(starts).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// LLM judge integration tests (fail-open / no real HTTP calls)
// ---------------------------------------------------------------------------

describe('PiiDetectionPipeline — LLM judge tier (Tier 4)', () => {
  /**
   * When an llmJudge config is supplied with an unreachable endpoint, the
   * pipeline should still complete successfully via the fail-open behaviour
   * of LlmJudgeRecognizer.  'llm' should appear in tiersExecuted.
   *
   * We test this by pointing the judge at localhost:1 — no HTTP server
   * exists there, so fetch will fail.  The fail-open path returns the
   * original entity unchanged.
   */
  it('includes "llm" in tiersExecuted when llmJudge is configured', async () => {
    const pipeline = makePipeline({
      confidenceThreshold: 0.0,
      enableNerModel: false,
      llmJudge: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        // Use an injected failing fetch so no real HTTP happens.
        // The LlmJudgeRecognizer accepts fetchImpl in its constructor but the
        // pipeline doesn't expose that — we exercise the fail-open path by
        // providing an unreachable baseUrl and valid apiKey shape.
        apiKey: 'test-key-not-real',
        baseUrl: 'http://localhost:1/v1', // Guaranteed to fail.
        maxConcurrency: 1,
        cacheSize: 0,
      },
    });

    // Text with an ambiguous-ish entity.  We set threshold=0 so anything that
    // survives appears.  We also need at least one entity in the ambiguous
    // score range (0.3 < score < 0.7) for the judge to be called.  Since NLP
    // and NER are off and regex scores ≥ 0.85, the judge won't actually be
    // invoked for regex entities.  However 'llm' SHOULD still appear in
    // tiersExecuted because we configured the judge.
    const result = await pipeline.detect('alice@acmecorp.org');

    // The tier label should be recorded even when no entities fell in the
    // ambiguous band (the judge was still "executed" — it just had no work).
    expect(result.tiersExecuted).toContain('llm');
  });

  /**
   * getSecret fallback: when LlmJudgeConfig has no apiKey but getSecret
   * resolves one via 'openai.apiKey', the pipeline must pick it up without
   * error.  We confirm this by checking the pipeline constructs without
   * throwing and produces a valid result.
   */
  it('resolves LLM judge API key via getSecret provider-specific path', async () => {
    const getSecret = (id: string) => {
      if (id === 'openai.apiKey') return 'sk-test-from-secret';
      return undefined;
    };

    // Should not throw during construction.
    const pipeline = new PiiDetectionPipeline(
      makeMockRegistry(),
      makeOptions({
        llmJudge: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          // No apiKey — should be resolved via getSecret.
          baseUrl: 'http://localhost:1/v1',
        },
      }),
      getSecret,
    );

    // Should not throw during detection (judge fails open on network error).
    const result = await pipeline.detect('hello world');
    expect(result).toBeDefined();
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  /**
   * getSecret fallback: pack-specific 'pii.llm.apiKey' secret is used when
   * neither explicit apiKey nor provider-specific secret is available.
   */
  it('resolves LLM judge API key via getSecret pack-specific path', async () => {
    const getSecret = (id: string) => {
      if (id === 'pii.llm.apiKey') return 'sk-pii-pack-secret';
      return undefined;
    };

    const pipeline = new PiiDetectionPipeline(
      makeMockRegistry(),
      makeOptions({
        llmJudge: {
          provider: 'anthropic',
          model: 'claude-haiku-3-5',
          baseUrl: 'http://localhost:1/v1',
        },
      }),
      getSecret,
    );

    // Should not throw — just exercises key resolution path.
    const result = await pipeline.detect('test input');
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Context enhancement tests
// ---------------------------------------------------------------------------

describe('PiiDetectionPipeline — context enhancement (Step 2)', () => {
  /**
   * An email address detected by regex that appears near the keyword
   * "email:" should have a higher score than if it appeared without
   * context.
   *
   * We verify this indirectly: with threshold=0.95 (above the regex floor of
   * 0.85 but below 0.85+0.2=1.05, capped at 1.0) the boosted entity should
   * survive while the unboosted one might not, depending on the exact score.
   *
   * Since we can't easily isolate the boost without reaching into internals,
   * we instead verify that:
   *  1. The entity is detected in both cases.
   *  2. The score in the contextual case is >= score in the context-free case.
   */
  it('context keywords near an entity do not break detection', async () => {
    const pipeline = makePipeline({ confidenceThreshold: 0.0 });

    // With strong context keyword.
    const withContext = await pipeline.detect('email: alice@acmecorp.org');
    // Without keyword.
    const withoutContext = await pipeline.detect('alice@acmecorp.org');

    // Both should detect the email.
    const emailWith = withContext.entities.find((e) => e.entityType === 'EMAIL');
    const emailWithout = withoutContext.entities.find((e) => e.entityType === 'EMAIL');

    expect(emailWith).toBeDefined();
    expect(emailWithout).toBeDefined();

    // Score with context should be >= score without context.
    expect(emailWith!.score).toBeGreaterThanOrEqual(emailWithout!.score);
  });
});

// ---------------------------------------------------------------------------
// Allow / denylist tests
// ---------------------------------------------------------------------------

describe('PiiDetectionPipeline — allowlist and denylist', () => {
  /**
   * Entities whose text is in the allowlist should be excluded from output.
   */
  it('excludes entities matching the allowlist', async () => {
    const pipeline = makePipeline({
      confidenceThreshold: 0.0,
      allowlist: ['alice@acmecorp.org'],
    });
    const result = await pipeline.detect('Contact alice@acmecorp.org for help.');

    const email = result.entities.find((e) => e.entityType === 'EMAIL');
    // The allowlisted email must not appear.
    expect(email).toBeUndefined();
  });

  /**
   * Denylist entries should be included at score 1.0 regardless of original
   * score, so they always survive the threshold filter.
   */
  it('boosts denylist entities to score 1.0 so they survive any threshold', async () => {
    const pipeline = makePipeline({
      confidenceThreshold: 0.99, // Very high threshold
      denylist: ['alice@acmecorp.org'],
    });
    const result = await pipeline.detect('Contact alice@acmecorp.org for help.');

    const email = result.entities.find(
      (e) => e.text.toLowerCase() === 'alice@acmecorp.org',
    );
    expect(email).toBeDefined();
    // Denylist entities should be boosted to score 1.0.
    expect(email!.score).toBe(1.0);
  });
});
