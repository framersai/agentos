import { describe, it, expect } from 'vitest';
import { StreamingReconstructor, reconstructStream } from '../StreamingReconstructor';
import { ModelCompletionResponse, ChatMessage } from '../../providers/IProvider';

function makeChunk(partial: Partial<ModelCompletionResponse>): ModelCompletionResponse {
  return {
    id: partial.id || 'req1',
    object: partial.object || 'chat.completion.chunk',
    created: partial.created || Date.now()/1000,
    modelId: partial.modelId || 'test-model',
    choices: partial.choices || [{ index: 0, message: { role: 'assistant', content: null } as ChatMessage, finishReason: null }],
    usage: partial.usage,
    error: partial.error,
    responseTextDelta: partial.responseTextDelta,
    toolCallsDeltas: partial.toolCallsDeltas,
    isFinal: partial.isFinal,
  };
}

describe('StreamingReconstructor', () => {
  it('reconstructs text deltas and tool arguments', async () => {
    const chunks: ModelCompletionResponse[] = [
      makeChunk({ responseTextDelta: 'Hello ', toolCallsDeltas: [{ index: 0, function: { name: 'calc', arguments_delta: '{"a":' } }] }),
      makeChunk({ responseTextDelta: 'world', toolCallsDeltas: [{ index: 0, function: { arguments_delta: '1,"b":2' } }] }),
      makeChunk({ responseTextDelta: '!', toolCallsDeltas: [{ index: 0, function: { arguments_delta: '}' } }], isFinal: true, usage: { totalTokens: 42 } }),
    ];
    async function* gen() { for (const c of chunks) yield c; }
    const result = await reconstructStream(gen());
    expect(result.fullText).toBe('Hello world!');
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0].arguments).toEqual({ a: 1, b: 2 });
    expect(result.usage?.totalTokens).toBe(42);
    expect(result.finalChunk?.isFinal).toBe(true);
  });

  it('captures parse errors gracefully', () => {
    const r = new StreamingReconstructor();
    r.push(makeChunk({ responseTextDelta: 'Bad ', toolCallsDeltas: [{ index: 1, function: { name: 'broken', arguments_delta: '{invalid' } }] }));
    r.push(makeChunk({ responseTextDelta: 'JSON', toolCallsDeltas: [{ index: 1, function: { arguments_delta: '}' } }], isFinal: true }));
    const calls = r.getToolCalls();
    const bad = calls.find(c => c.index === 1)!;
    expect(bad.arguments).toBeUndefined();
    expect(bad.parseError).toBeTruthy();
    expect(r.getFullText()).toBe('Bad JSON');
    expect(r.getFinalChunk()?.isFinal).toBe(true);
  });
});
