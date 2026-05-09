/**
 * @fileoverview Tests for HybridUtilityAI delegation behavior on classifyText
 * and analyzeSentiment, including fallback when the primary backend fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HybridUtilityAI } from '../HybridUtilityAI';
import type { IUtilityAI } from '../IUtilityAI';

/** Creates a mock IUtilityAI with all methods stubbed. */
function createMockUtility(id: string): IUtilityAI {
  return {
    utilityId: id,
    initialize: vi.fn().mockResolvedValue(undefined),
    summarize: vi.fn().mockResolvedValue('summary'),
    classifyText: vi.fn().mockResolvedValue({
      bestClass: 'attack',
      confidence: 0.9,
      allScores: [{ classLabel: 'attack', score: 0.9 }],
    }),
    extractKeywords: vi.fn().mockResolvedValue(['keyword1', 'keyword2']),
    parseJsonSafe: vi.fn().mockResolvedValue({ parsed: true }),
    tokenize: vi.fn().mockResolvedValue(['token1', 'token2']),
    stemTokens: vi.fn().mockResolvedValue(['stem1', 'stem2']),
    normalizeText: vi.fn().mockResolvedValue('normalized'),
    generateNGrams: vi.fn().mockResolvedValue({ 2: [['a', 'b']] }),
    calculateReadability: vi.fn().mockResolvedValue({ score: 70, grade: '8th' }),
    calculateSimilarity: vi.fn().mockResolvedValue(0.85),
    analyzeSentiment: vi.fn().mockResolvedValue({
      score: 0.6,
      polarity: 'positive',
      comparative: 0.3,
      intensity: 0.5,
      positiveTokens: [],
      negativeTokens: [],
    }),
    detectLanguage: vi.fn().mockResolvedValue([{ language: 'en', confidence: 0.99 }]),
    checkHealth: vi.fn().mockResolvedValue({ isHealthy: true, details: 'ok' }),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

describe('HybridUtilityAI — classifyText delegation', () => {
  let llmMock: IUtilityAI;
  let statMock: IUtilityAI;

  beforeEach(() => {
    llmMock = createMockUtility('llm-mock');
    statMock = createMockUtility('stat-mock');
  });

  it('classifyText delegates to LLM backend (not stat)', async () => {
    const hybrid = new HybridUtilityAI({ llm: llmMock, statistical: statMock });
    const result = await hybrid.classifyText('swing my sword', {
      candidateClasses: ['attack', 'equip', 'buy'],
    });
    expect(llmMock.classifyText).toHaveBeenCalledWith('swing my sword', {
      candidateClasses: ['attack', 'equip', 'buy'],
    });
    expect(statMock.classifyText).not.toHaveBeenCalled();
    expect(result.bestClass).toBe('attack');
  });

  it('falls back to stat when LLM classifyText fails', async () => {
    (llmMock.classifyText as any).mockRejectedValueOnce(new Error('LLM unavailable'));

    const hybrid = new HybridUtilityAI({ statistical: statMock });
    const result = await hybrid.classifyText('buy a potion', {
      candidateClasses: ['attack', 'equip', 'buy'],
    });
    expect(statMock.classifyText).toHaveBeenCalled();
    expect(result.bestClass).toBeDefined();
  });

  it('classifyText delegates to stat when LLM backend is absent', async () => {
    const hybrid = new HybridUtilityAI({ statistical: statMock });
    await hybrid.classifyText('equip the staff', {
      candidateClasses: ['attack', 'equip', 'buy'],
    });
    expect(statMock.classifyText).toHaveBeenCalled();
  });
});

describe('HybridUtilityAI — analyzeSentiment delegation', () => {
  let llmMock: IUtilityAI;
  let statMock: IUtilityAI;

  beforeEach(() => {
    llmMock = createMockUtility('llm-mock');
    statMock = createMockUtility('stat-mock');
  });

  it('analyzeSentiment delegates to stat backend (fast lexicon preferred)', async () => {
    const hybrid = new HybridUtilityAI({ llm: llmMock, statistical: statMock });
    const result = await hybrid.analyzeSentiment('this is a wonderful day');
    expect(statMock.analyzeSentiment).toHaveBeenCalledWith('this is a wonderful day', undefined);
    expect(llmMock.analyzeSentiment).not.toHaveBeenCalled();
    expect(result.polarity).toBe('positive');
  });

  it('analyzeSentiment falls back to LLM when stat is absent', async () => {
    const hybrid = new HybridUtilityAI({ llm: llmMock });
    await hybrid.analyzeSentiment('great news');
    expect(llmMock.analyzeSentiment).toHaveBeenCalled();
  });

  it('analyzeSentiment returns correct structure', async () => {
    const hybrid = new HybridUtilityAI({ llm: llmMock, statistical: statMock });
    const result = await hybrid.analyzeSentiment('happy day');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('polarity');
    expect(typeof result.score).toBe('number');
    expect(['positive', 'negative', 'neutral']).toContain(result.polarity);
  });
});
