import { describe, it, expect, vi } from 'vitest';
import { AvatarPipeline } from '../AvatarPipeline.js';

describe('AvatarPipeline — Consistency Mode Per Stage', () => {
  const mockEmbeddingVector = new Array(512).fill(0.1);

  const mockFaceService = {
    extractEmbedding: vi.fn().mockResolvedValue({
      vector: mockEmbeddingVector,
      confidence: 0.99,
    }),
    compareFaces: vi.fn().mockReturnValue({ similarity: 0.95, match: true }),
  };

  it('passes strict consistencyMode for expression_sheet stage', async () => {
    const calls: Array<{ prompt: string; options: any }> = [];
    const mockGenerator = vi.fn(async (prompt: string, options: any) => {
      calls.push({ prompt, options });
      return 'https://generated.test/img.png';
    });

    const pipeline = new AvatarPipeline(mockFaceService as any, mockGenerator);
    await pipeline.generate({
      characterId: 'char_1',
      identity: {
        displayName: 'Test Character',
        ageBand: 'adult',
        faceDescriptor: 'oval face, brown eyes',
      },
      generationConfig: { baseModel: 'flux-schnell', provider: 'replicate' },
      stages: ['neutral_portrait', 'face_embedding', 'expression_sheet'],
    });

    // Expression calls (after neutral + face_embedding) should have strict
    const strictCalls = calls.filter(c => c.options.consistencyMode === 'strict');
    expect(strictCalls.length).toBeGreaterThan(0);
  });

  it('passes balanced consistencyMode for full_body stage', async () => {
    const calls: Array<{ prompt: string; options: any }> = [];
    const mockGenerator = vi.fn(async (prompt: string, options: any) => {
      calls.push({ prompt, options });
      return 'https://generated.test/img.png';
    });

    const pipeline = new AvatarPipeline(mockFaceService as any, mockGenerator);
    await pipeline.generate({
      characterId: 'char_1',
      identity: {
        displayName: 'Test Character',
        ageBand: 'adult',
        faceDescriptor: 'oval face, brown eyes',
      },
      generationConfig: { baseModel: 'flux-schnell', provider: 'replicate' },
      stages: ['neutral_portrait', 'face_embedding', 'full_body'],
    });

    const balancedCalls = calls.filter(c => c.options.consistencyMode === 'balanced');
    expect(balancedCalls.length).toBeGreaterThan(0);
  });

  it('passes faceEmbedding to generator for post-embedding stages', async () => {
    const calls: Array<{ prompt: string; options: any }> = [];
    const mockGenerator = vi.fn(async (prompt: string, options: any) => {
      calls.push({ prompt, options });
      return 'https://generated.test/img.png';
    });

    const pipeline = new AvatarPipeline(mockFaceService as any, mockGenerator);
    await pipeline.generate({
      characterId: 'char_1',
      identity: {
        displayName: 'Test Character',
        ageBand: 'adult',
        faceDescriptor: 'oval face',
      },
      generationConfig: { baseModel: 'flux-schnell', provider: 'replicate' },
      stages: ['neutral_portrait', 'face_embedding', 'expression_sheet'],
    });

    // After face_embedding stage, expression calls should include the embedding
    const withEmbedding = calls.filter(
      c => Array.isArray(c.options.faceEmbedding) && c.options.faceEmbedding.length === 512
    );
    expect(withEmbedding.length).toBeGreaterThan(0);
  });

  it('neutral_portrait stage does not pass consistencyMode', async () => {
    const calls: Array<{ prompt: string; options: any }> = [];
    const mockGenerator = vi.fn(async (prompt: string, options: any) => {
      calls.push({ prompt, options });
      return 'https://generated.test/img.png';
    });

    const pipeline = new AvatarPipeline(mockFaceService as any, mockGenerator);
    await pipeline.generate({
      characterId: 'char_1',
      identity: {
        displayName: 'Test Character',
        ageBand: 'adult',
        faceDescriptor: 'oval face',
      },
      generationConfig: { baseModel: 'flux-schnell', provider: 'replicate' },
      stages: ['neutral_portrait'],
    });

    // First call is the neutral portrait — should not have consistencyMode
    expect(calls[0].options.consistencyMode).toBeUndefined();
  });
});
