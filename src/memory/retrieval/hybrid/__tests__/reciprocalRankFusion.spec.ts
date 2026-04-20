import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from '../reciprocalRankFusion.js';

describe('reciprocalRankFusion', () => {
  it('applies standard RRF math with default k=60', () => {
    const dense = [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }];
    const sparse = [{ id: 'b', rank: 1 }, { id: 'c', rank: 2 }];
    const results = reciprocalRankFusion(dense, sparse);
    // a: 0.7 / (60 + 1) = 0.01147...
    // b: 0.7 / 62 + 0.3 / 61 = 0.01129 + 0.00492 = 0.01620
    // c: 0.3 / (60 + 2) = 0.00484
    expect(results[0].id).toBe('b');
    expect(results[1].id).toBe('a');
    expect(results[2].id).toBe('c');
    expect(results[0].denseRank).toBe(2);
    expect(results[0].sparseRank).toBe(1);
    expect(results[2].denseRank).toBeUndefined();
  });

  it('weight influence: w_dense=0.9 pushes dense-rank-1 above sparse-rank-1', () => {
    const dense = [{ id: 'a', rank: 1 }];
    const sparse = [{ id: 'b', rank: 1 }];
    const results = reciprocalRankFusion(dense, sparse, {
      denseWeight: 0.9,
      sparseWeight: 0.1,
    });
    expect(results[0].id).toBe('a');
    expect(results[1].id).toBe('b');
  });

  it('missing rank on one side: sparse-only doc has undefined denseRank', () => {
    const dense = [{ id: 'a', rank: 1 }];
    const sparse = [{ id: 'z', rank: 1 }];
    const results = reciprocalRankFusion(dense, sparse);
    const zResult = results.find((r) => r.id === 'z');
    expect(zResult).toBeDefined();
    expect(zResult!.denseRank).toBeUndefined();
    expect(zResult!.sparseRank).toBe(1);
  });

  it('empty inputs: both empty returns empty; one empty returns other side only', () => {
    expect(reciprocalRankFusion([], [])).toEqual([]);
    const denseOnly = reciprocalRankFusion(
      [{ id: 'a', rank: 1 }],
      [],
    );
    expect(denseOnly).toHaveLength(1);
    expect(denseOnly[0].id).toBe('a');
    expect(denseOnly[0].sparseRank).toBeUndefined();
  });

  it('stable tiebreak by id when scores are identical', () => {
    const dense = [{ id: 'zzz', rank: 1 }, { id: 'aaa', rank: 1 }];
    const sparse: { id: string; rank: number }[] = [];
    const results = reciprocalRankFusion(dense, sparse);
    expect(results[0].id).toBe('aaa');
    expect(results[1].id).toBe('zzz');
  });
});
