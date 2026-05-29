// File: packages/agentos/src/core/llm/streaming/tests/StreamingBatcher.test.ts
import { describe, it, expect } from 'vitest';
import { batchStream, StreamingBatcher } from '../StreamingBatcher';
import { ModelCompletionResponse } from '../../providers/IProvider';

function makeDelta(id: string, text: string, opts?: Partial<ModelCompletionResponse>): ModelCompletionResponse {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now()/1000),
    modelId: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content: null }, finishReason: null }],
    responseTextDelta: text,
    ...opts,
  } as ModelCompletionResponse;
}

async function collect(gen: AsyncGenerator<ModelCompletionResponse>): Promise<ModelCompletionResponse[]> {
  const out: ModelCompletionResponse[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

describe('StreamingBatcher', () => {
  it('batches multiple small chunks by size threshold', async () => {
    async function* source() {
      yield makeDelta('c1','Hello ');
      yield makeDelta('c2','world');
      yield makeDelta('c3','!');
      yield makeDelta('c4',' Done.', { isFinal: true, usage: { totalTokens: 10 } as any });
    }
    const batched = batchStream(source(), { maxTextDeltaChars: 20, maxLatencyMs: 1000 });
    const out = await collect(batched);
    expect(out.length).toBe(2); // One batch for first 3 deltas, one final batch
    expect(out[0].responseTextDelta).toBe('Hello world!');
    expect(out[0].isFinal).toBeFalsy();
    expect(out[1].isFinal).toBe(true);
    expect(out[1].responseTextDelta).toBe(' Done.');
    expect(out[1].usage?.totalTokens).toBe(10);
  });

  it('flushes on latency even if size small', async () => {
    async function* source() {
      yield makeDelta('c1','A');
      await new Promise(r => setTimeout(r, 120)); // exceed default latency 100ms
      yield makeDelta('c2','B');
      yield makeDelta('c3','C', { isFinal: true });
    }
    const batched = batchStream(source(), { maxLatencyMs: 100, maxTextDeltaChars: 1000 });
    const out = await collect(batched);
    // Expect three batches: first 'A' (flushed by latency), second 'B', third final 'C'
    expect(out.map(o => o.responseTextDelta)).toEqual(['A','B','C']);
  });

  it('propagates tool argument deltas merged per batch', async () => {
    async function* source() {
      yield makeDelta('t1','', { toolCallsDeltas: [{ index: 0, function: { name: 'calc', arguments_delta: '{"a":1,' } }] });
      yield makeDelta('t2','', { toolCallsDeltas: [{ index: 0, function: { arguments_delta: '"b":2}' } }] });
      yield makeDelta('t3','', { isFinal: true });
    }
    const out = await collect(batchStream(source(), { maxLatencyMs: 1000 }));
    expect(out.length).toBe(2); // first batch merges t1 + t2, second final empty
    const merged = out[0].toolCallsDeltas?.[0].function?.arguments_delta;
    expect(merged).toBe('{"a":1,"b":2}');
  });

  it('supports OO wrapper StreamingBatcher', async () => {
    async function* source() { yield makeDelta('x1','Hi', { isFinal: true }); }
    const wrapper = new StreamingBatcher({ maxLatencyMs: 50 });
    const out = await collect(wrapper.batch(source()));
    expect(out.length).toBe(1);
    expect(out[0].isFinal).toBe(true);
  });
});