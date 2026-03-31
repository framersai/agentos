import { describe, it, expect, vi } from 'vitest';
import { CitationVerifier } from '../CitationVerifier.js';

/** Deterministic mock embedding for testing. */
function mockEmbedFn(texts: string[]): Promise<number[][]> {
  return Promise.resolve(texts.map(t => {
    const vec = new Array(8).fill(0);
    for (let i = 0; i < t.length; i++) {
      vec[i % 8] += t.charCodeAt(i) / 1000;
    }
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return mag > 0 ? vec.map(v => v / mag) : vec;
  }));
}

describe('CitationVerifier', () => {
  const verifier = new CitationVerifier({ embedFn: mockEmbedFn });

  it('verifies claims against matching sources', async () => {
    const result = await verifier.verify(
      'The sky appears blue during daytime. Water molecules are fundamentally wet in nature.',
      [{ content: 'The sky appears blue during daytime due to scattering.' }, { content: 'Water molecules are wet and cold.' }],
    );
    expect(result.totalClaims).toBe(2);
    expect(result.claims.every(c => c.verdict === 'supported' || c.verdict === 'weak')).toBe(true);
    expect(result.overallGrounded).toBe(true);
  });

  it('assigns verdicts based on cosine similarity thresholds', async () => {
    // With mock embeddings, all text gets some similarity — test the structure
    const result = await verifier.verify(
      'This is a very specific technical claim about quantum mechanics.',
      [{ content: 'Cats are small domesticated mammals that purr.' }],
    );
    expect(result.totalClaims).toBe(1);
    expect(result.claims[0].confidence).toBeGreaterThanOrEqual(0);
    expect(result.claims[0].confidence).toBeLessThanOrEqual(1);
    expect(['supported', 'weak', 'unverifiable']).toContain(result.claims[0].verdict);
  });

  it('returns empty result for empty text', async () => {
    const result = await verifier.verify('', [{ content: 'source' }]);
    expect(result.totalClaims).toBe(0);
    expect(result.overallGrounded).toBe(true);
    expect(result.supportedRatio).toBe(1);
  });

  it('uses custom extractClaims when provided', async () => {
    const customExtract = vi.fn().mockResolvedValue(['Claim A.', 'Claim B.']);
    const v = new CitationVerifier({ embedFn: mockEmbedFn, extractClaims: customExtract });
    const result = await v.verify('Some text.', [{ content: 'source' }]);
    expect(customExtract).toHaveBeenCalledWith('Some text.');
    expect(result.totalClaims).toBe(2);
  });

  it('detects contradiction via NLI', async () => {
    const nliFn = vi.fn().mockResolvedValue({ label: 'contradiction', score: 0.9 });
    const v = new CitationVerifier({
      embedFn: mockEmbedFn,
      nliFn,
      supportThreshold: 0.01,
    });
    const result = await v.verify(
      'The earth is flat.',
      [{ content: 'The earth is flat.' }],
    );
    expect(result.claims[0].verdict).toBe('contradicted');
    expect(result.overallGrounded).toBe(false);
  });

  it('generates correct summary string', async () => {
    const result = await verifier.verify(
      'Cats are mammals. Dogs are reptiles.',
      [{ content: 'Cats are small domesticated mammals.' }],
    );
    expect(result.summary).toMatch(/\d+\/\d+ claims verified/);
  });
});
