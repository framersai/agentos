/**
 * @fileoverview Unit tests for `SlidingWindowBuffer`.
 *
 * Tests verify:
 *  - Null return until chunkSize is reached
 *  - ChunkReady emission once chunkSize is reached
 *  - Context carry-forward between consecutive chunks
 *  - Multiple concurrent streams operate independently
 *  - maxEvaluations budget is respected
 *  - flush() returns remaining buffer content
 *  - flush() returns null for empty or unknown streams
 *  - pruneStale() removes expired streams
 *  - clear() removes all streams
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SlidingWindowBuffer,
} from '../../../../src/extensions/packs/ml-classifiers/SlidingWindowBuffer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a string of exactly `charCount` characters so token estimation
 * (ceil(length/4)) is predictable.
 */
function chars(charCount: number): string {
  return 'a'.repeat(charCount);
}

/**
 * Push enough characters to fill exactly `tokenCount` estimated tokens
 * (4 chars per token) into the buffer for the given stream.
 */
function pushTokens(
  buf: SlidingWindowBuffer,
  streamId: string,
  tokenCount: number,
) {
  return buf.push(streamId, chars(tokenCount * 4));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SlidingWindowBuffer', () => {
  let buf: SlidingWindowBuffer;

  beforeEach(() => {
    // Fresh buffer for every test with small sizes to keep tests fast.
    buf = new SlidingWindowBuffer({
      chunkSize: 10,       // 10 tokens = 40 chars before a chunk fires
      contextSize: 5,      // keep 5 tokens (20 chars) of context
      maxEvaluations: 5,
      streamTimeoutMs: 1000,
    });
  });

  // -------------------------------------------------------------------------
  // Basic accumulation
  // -------------------------------------------------------------------------

  describe('returns null until chunkSize is reached', () => {
    it('returns null for a single short push', () => {
      // Push 5 tokens (< chunkSize of 10)
      expect(pushTokens(buf, 'stream-a', 5)).toBeNull();
    });

    it('returns null for multiple small pushes that do not reach chunkSize', () => {
      expect(buf.push('stream-a', chars(8))).toBeNull();  // 2 tokens
      expect(buf.push('stream-a', chars(8))).toBeNull();  // 2 tokens
      expect(buf.push('stream-a', chars(8))).toBeNull();  // 2 tokens
      // Total: 6 tokens — still below 10
    });
  });

  describe('returns ChunkReady when chunkSize is reached', () => {
    it('emits a chunk exactly when chunkSize tokens accumulate', () => {
      // Push 9 tokens first — still under threshold
      expect(pushTokens(buf, 'stream-a', 9)).toBeNull();

      // Push 1 more token to hit chunkSize=10
      const chunk = pushTokens(buf, 'stream-a', 1);
      expect(chunk).not.toBeNull();
      expect(chunk!.evaluationNumber).toBe(1);
    });

    it('chunk.newText equals exactly what was buffered', () => {
      // Push exactly chunkSize tokens in one shot
      const chunk = pushTokens(buf, 'stream-a', 10);
      expect(chunk).not.toBeNull();
      // newText should be the 40 chars we pushed
      expect(chunk!.newText).toHaveLength(40);
    });

    it('chunk.text equals contextRing (empty on first chunk) + newText', () => {
      const chunk = pushTokens(buf, 'stream-a', 10);
      // No prior context on first chunk → text === newText
      expect(chunk!.text).toBe(chunk!.newText);
    });

    it('evaluationNumber starts at 1', () => {
      const chunk = pushTokens(buf, 'stream-a', 10);
      expect(chunk!.evaluationNumber).toBe(1);
    });

    it('evaluationNumber increments on successive chunks', () => {
      const c1 = pushTokens(buf, 'stream-a', 10);
      const c2 = pushTokens(buf, 'stream-a', 10);
      expect(c1!.evaluationNumber).toBe(1);
      expect(c2!.evaluationNumber).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Context carry-forward
  // -------------------------------------------------------------------------

  describe('context carry-forward between chunks', () => {
    it('second chunk text is longer than its newText (context prepended)', () => {
      // Emit first chunk
      pushTokens(buf, 'stream-a', 10);

      // Emit second chunk
      const c2 = pushTokens(buf, 'stream-a', 10);
      expect(c2).not.toBeNull();

      // text = contextRing (≤ contextSize=5 tokens = 20 chars) + newText (40 chars)
      expect(c2!.text.length).toBeGreaterThan(c2!.newText.length);
    });

    it('context length is bounded by contextSize tokens', () => {
      pushTokens(buf, 'stream-a', 10); // first chunk

      const c2 = pushTokens(buf, 'stream-a', 10);
      const contextLen = c2!.text.length - c2!.newText.length;

      // contextSize=5 tokens ≈ 20 chars; context length must be ≤ 20
      expect(contextLen).toBeLessThanOrEqual(5 * 4);
    });

    it('context is derived from the tail of the previous buffer', () => {
      // Use distinct characters to trace which text makes it into the context.
      // First window: 10 tokens of 'x'
      buf.push('stream-a', 'x'.repeat(40));

      // Second window: 10 tokens of 'y'
      const c2 = buf.push('stream-a', 'y'.repeat(40));
      expect(c2).not.toBeNull();

      // The text should start with some 'x' context, then 'y' new content.
      expect(c2!.text).toContain('x'); // context from first window
      expect(c2!.newText).toBe('y'.repeat(40)); // only new content
    });
  });

  // -------------------------------------------------------------------------
  // Multiple concurrent streams
  // -------------------------------------------------------------------------

  describe('multiple concurrent streams are independent', () => {
    it('two streams accumulate independently', () => {
      // Push 8 tokens into stream-a, 10 tokens into stream-b
      pushTokens(buf, 'stream-a', 8); // not ready
      const chunkB = pushTokens(buf, 'stream-b', 10); // ready

      expect(chunkB).not.toBeNull();

      // stream-a should still be null (only 8 tokens)
      const chunkA = buf.push('stream-a', ''); // empty push, no change
      expect(chunkA).toBeNull();
    });

    it('flushing one stream does not affect another', () => {
      pushTokens(buf, 'stream-a', 5); // partial
      pushTokens(buf, 'stream-b', 5); // partial

      buf.flush('stream-a');

      // stream-b still exists and can be flushed separately
      const chunkB = buf.flush('stream-b');
      expect(chunkB).not.toBeNull();
      expect(chunkB!.newText).toHaveLength(20); // 5 tokens * 4 chars
    });

    it('context rings are independent per stream', () => {
      // Emit first chunk for each stream with distinct chars
      buf.push('stream-a', 'A'.repeat(40));
      buf.push('stream-b', 'B'.repeat(40));

      const c2a = pushTokens(buf, 'stream-a', 10);
      const c2b = pushTokens(buf, 'stream-b', 10);

      // stream-a context should contain 'A', not 'B'
      expect(c2a!.text).toContain('A');
      expect(c2a!.text).not.toContain('B');

      // stream-b context should contain 'B', not 'A'
      expect(c2b!.text).toContain('B');
      expect(c2b!.text).not.toContain('A');
    });
  });

  // -------------------------------------------------------------------------
  // Evaluation budget (maxEvaluations)
  // -------------------------------------------------------------------------

  describe('maxEvaluations budget', () => {
    it('returns null after maxEvaluations chunks are emitted', () => {
      // Emit exactly maxEvaluations=5 chunks
      for (let i = 0; i < 5; i++) {
        const chunk = pushTokens(buf, 'stream-a', 10);
        expect(chunk).not.toBeNull();
      }

      // 6th push should return null even though enough tokens are pushed
      const extra = pushTokens(buf, 'stream-a', 10);
      expect(extra).toBeNull();
    });

    it('budget is tracked per-stream (other streams unaffected)', () => {
      // Exhaust stream-a
      for (let i = 0; i < 5; i++) {
        pushTokens(buf, 'stream-a', 10);
      }

      // stream-b should still be able to emit chunks
      const chunkB = pushTokens(buf, 'stream-b', 10);
      expect(chunkB).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // flush()
  // -------------------------------------------------------------------------

  describe('flush()', () => {
    it('returns a ChunkReady for remaining buffered text', () => {
      buf.push('stream-a', chars(20)); // 5 tokens, less than chunkSize=10
      const chunk = buf.flush('stream-a');

      expect(chunk).not.toBeNull();
      expect(chunk!.newText).toHaveLength(20);
    });

    it('returned chunk includes context from prior windows', () => {
      // Emit one full chunk first
      pushTokens(buf, 'stream-a', 10);

      // Push partial second window
      buf.push('stream-a', chars(20)); // 5 tokens

      const chunk = buf.flush('stream-a');
      expect(chunk).not.toBeNull();
      // text should be longer than newText (context prepended)
      expect(chunk!.text.length).toBeGreaterThan(chunk!.newText.length);
    });

    it('returns null for empty buffer', () => {
      // Push nothing, then flush
      const chunk = buf.flush('stream-empty');
      expect(chunk).toBeNull();
    });

    it('returns null for a non-existent stream', () => {
      expect(buf.flush('does-not-exist')).toBeNull();
    });

    it('removes the stream from internal state after flush', () => {
      buf.push('stream-a', chars(20));
      buf.flush('stream-a');

      // size should be 0 after flushing the only stream
      expect(buf.size).toBe(0);
    });

    it('subsequent flush on same stream returns null', () => {
      buf.push('stream-a', chars(20));
      buf.flush('stream-a');

      // Second flush: stream was deleted
      expect(buf.flush('stream-a')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // pruneStale()
  // -------------------------------------------------------------------------

  describe('pruneStale()', () => {
    it('removes streams that have exceeded streamTimeoutMs', async () => {
      // Use a very short timeout for this test
      const shortBuf = new SlidingWindowBuffer({
        chunkSize: 10,
        contextSize: 5,
        maxEvaluations: 5,
        streamTimeoutMs: 50, // 50 ms
      });

      shortBuf.push('old-stream', chars(20)); // partial push

      // Wait for the timeout to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      shortBuf.pruneStale();
      expect(shortBuf.size).toBe(0);
    });

    it('does not remove streams that are still within the timeout', async () => {
      const shortBuf = new SlidingWindowBuffer({
        chunkSize: 10,
        contextSize: 5,
        maxEvaluations: 5,
        streamTimeoutMs: 5000,
      });

      shortBuf.push('fresh-stream', chars(20));
      shortBuf.pruneStale();

      // Should still be present
      expect(shortBuf.size).toBe(1);
    });

    it('is invoked lazily when map.size > 10', async () => {
      const shortBuf = new SlidingWindowBuffer({
        chunkSize: 10,
        contextSize: 5,
        maxEvaluations: 5,
        streamTimeoutMs: 1, // expire immediately
      });

      // Create 10 streams that will immediately be stale
      for (let i = 0; i < 10; i++) {
        shortBuf.push(`stale-${i}`, chars(4));
      }

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Push to an 11th stream — this triggers lazy pruning
      shortBuf.push('trigger-prune', chars(4));

      // Stale streams should have been removed; only 'trigger-prune' remains
      expect(shortBuf.size).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // clear()
  // -------------------------------------------------------------------------

  describe('clear()', () => {
    it('removes all streams', () => {
      buf.push('s1', chars(20));
      buf.push('s2', chars(20));
      buf.push('s3', chars(20));

      buf.clear();
      expect(buf.size).toBe(0);
    });

    it('is idempotent on an empty buffer', () => {
      buf.clear();
      buf.clear();
      expect(buf.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('push with empty string returns null and creates no state', () => {
      expect(buf.push('stream-a', '')).toBeNull();
      expect(buf.size).toBe(0);
    });

    it('handles a single massive push that exceeds chunkSize', () => {
      // 20 tokens in one push — should still emit exactly one chunk
      const chunk = pushTokens(buf, 'stream-a', 20);
      expect(chunk).not.toBeNull();
      // After the chunk, residual text (10 extra tokens) stays in buffer
      // A second push of 0 tokens shouldn't fire a second chunk
      expect(buf.push('stream-a', '')).toBeNull();
    });
  });
});
