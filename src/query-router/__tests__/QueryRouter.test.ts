/**
 * @fileoverview Tests for QueryRouter — main orchestrator that wires together
 * QueryClassifier, QueryDispatcher, and QueryGenerator into a complete
 * classify -> dispatch -> generate pipeline.
 *
 * Mock strategy:
 * - `generateText` is mocked so no real LLM calls are made.
 * - `node:fs` is mocked so no real filesystem reads are required.
 * - The router is initialised with a minimal config pointing at a fake corpus.
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before any module imports that depend on them
// ---------------------------------------------------------------------------

vi.mock('../../api/generateText.js', () => ({
  generateText: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readdirSync: vi.fn().mockReturnValue([
      { name: 'pricing.md', isDirectory: () => false, isFile: () => true },
    ]),
    readFileSync: vi.fn().mockReturnValue('# Pricing\n\nStarts at $19/month for the Starter plan.'),
  };
});

import { generateText } from '../../api/generateText.js';
import { QueryRouter } from '../QueryRouter.js';
import type { QueryResult, ClassificationResult } from '../types.js';

const mockGenerateText = vi.mocked(generateText);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a QueryRouter instance with sensible test defaults.
 * Points knowledgeCorpus at a single fake directory (fs is mocked).
 */
function createRouter(overrides: Record<string, unknown> = {}): QueryRouter {
  return new QueryRouter({
    knowledgeCorpus: ['/fake/docs'],
    classifierModel: 'gpt-4o-mini',
    classifierProvider: 'openai',
    confidenceThreshold: 0.7,
    maxTier: 3,
    generationModel: 'gpt-4o-mini',
    generationModelDeep: 'gpt-4o',
    generationProvider: 'openai',
    graphEnabled: false,
    deepResearchEnabled: false,
    conversationWindowSize: 5,
    maxContextTokens: 4000,
    cacheResults: false,
    ...overrides,
  });
}

/**
 * Builds a mock generateText response containing a classifier JSON payload.
 * The classifier always returns T0 with high confidence for test predictability.
 */
function classifierResponse(tier = 0, confidence = 0.95) {
  return {
    text: JSON.stringify({
      thinking: 'Test classification reasoning.',
      tier,
      confidence,
      internal_knowledge_sufficient: tier === 0,
      suggested_sources: tier === 0 ? [] : ['vector'],
      tools_needed: [],
    }),
    provider: 'openai',
    model: 'gpt-4o-mini',
    usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
    toolCalls: [],
    finishReason: 'stop' as const,
  };
}

/** Builds a mock generateText response for the generation phase. */
function generatorResponse(answer = 'The Starter plan costs $19/month.') {
  return {
    text: answer,
    provider: 'openai',
    model: 'gpt-4o-mini',
    usage: { promptTokens: 150, completionTokens: 60, totalTokens: 210 },
    toolCalls: [],
    finishReason: 'stop' as const,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QueryRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1: classify() returns a ClassificationResult
  // -------------------------------------------------------------------------
  it('classify() returns a ClassificationResult', async () => {
    mockGenerateText.mockResolvedValueOnce(classifierResponse(1, 0.88));

    const router = createRouter();
    await router.init();

    const result = await router.classify('What is the pricing?');

    expect(result).toBeDefined();
    expect(result.tier).toBe(1);
    expect(result.confidence).toBe(0.88);
    expect(typeof result.reasoning).toBe('string');
    expect(Array.isArray(result.suggestedSources)).toBe(true);
    expect(Array.isArray(result.toolsNeeded)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 2: route() returns QueryResult with answer and classification
  // -------------------------------------------------------------------------
  it('route() returns a QueryResult with answer and classification', async () => {
    // First call = classifier, second call = generator
    mockGenerateText
      .mockResolvedValueOnce(classifierResponse(0, 0.95))
      .mockResolvedValueOnce(generatorResponse());

    const router = createRouter();
    await router.init();

    const result: QueryResult = await router.route('How much does it cost?');

    expect(result.answer).toBe('The Starter plan costs $19/month.');
    expect(result.classification).toBeDefined();
    expect(result.classification.tier).toBe(0);
    expect(result.classification.confidence).toBe(0.95);
    expect(Array.isArray(result.sources)).toBe(true);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.tiersUsed)).toBe(true);
    expect(result.tiersUsed).toContain(0);
  });

  // -------------------------------------------------------------------------
  // Test 3: onClassification hook fires during route()
  // -------------------------------------------------------------------------
  it('onClassification hook fires during route()', async () => {
    mockGenerateText
      .mockResolvedValueOnce(classifierResponse(0, 0.9))
      .mockResolvedValueOnce(generatorResponse());

    const onClassification = vi.fn();
    const router = createRouter({ onClassification });
    await router.init();

    await router.route('Tell me about pricing.');

    expect(onClassification).toHaveBeenCalledTimes(1);
    const hookArg: ClassificationResult = onClassification.mock.calls[0][0];
    expect(hookArg.tier).toBe(0);
    expect(hookArg.confidence).toBe(0.9);
  });

  // -------------------------------------------------------------------------
  // Test 4: close() doesn't throw
  // -------------------------------------------------------------------------
  it('close() does not throw', async () => {
    const router = createRouter();
    await router.init();

    await expect(router.close()).resolves.not.toThrow();
  });
});
