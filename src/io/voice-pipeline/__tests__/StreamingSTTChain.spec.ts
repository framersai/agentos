import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { StreamingSTTChain } from '../providers/StreamingSTTChain.js';
import { defaultCapabilities } from '../HealthyProvider.js';
import type { IStreamingSTT, StreamingSTTSession } from '../types.js';
import type { HealthyProvider } from '../HealthyProvider.js';

function mkSession(providerId: string): StreamingSTTSession {
  const ee = new EventEmitter();
  return Object.assign(ee, {
    providerId,
    async pushAudio() {},
    async close() {},
  }) as unknown as StreamingSTTSession;
}

function mkFakeProvider(opts: {
  id: string;
  priority?: number;
  startBehavior: 'success' | 'fail';
  failMessage?: string;
}): IStreamingSTT & HealthyProvider {
  return {
    providerId: opts.id,
    priority: opts.priority ?? 10,
    capabilities: defaultCapabilities({ languages: ['en'] }),
    isStreaming: false,
    async startSession() {
      if (opts.startBehavior === 'fail') {
        throw new Error(opts.failMessage ?? `fake ${opts.id} fail`);
      }
      return mkSession(opts.id);
    },
    async healthCheck() {
      return { ok: true };
    },
  };
}

describe('StreamingSTTChain — init-time fallback', () => {
  it('picks the first provider when primary succeeds', async () => {
    const a = mkFakeProvider({ id: 'a', startBehavior: 'success', priority: 10 });
    const b = mkFakeProvider({ id: 'b', startBehavior: 'success', priority: 20 });
    const selected = vi.fn();
    const chain = new StreamingSTTChain([a, b], { onProviderSelected: selected });
    const session = await chain.startSession();
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'a' }));
    expect(chain.currentProviderId).toBe('a');
    await session.close();
  });

  it('sorts providers by priority', async () => {
    // b has lower priority (tried first) even though declared second.
    const a = mkFakeProvider({ id: 'a', startBehavior: 'success', priority: 30 });
    const b = mkFakeProvider({ id: 'b', startBehavior: 'success', priority: 5 });
    const chain = new StreamingSTTChain([a, b]);
    const session = await chain.startSession();
    expect(chain.currentProviderId).toBe('b');
    await session.close();
  });

  it('falls back to the next when primary throws', async () => {
    const a = mkFakeProvider({
      id: 'a',
      startBehavior: 'fail',
      failMessage: '401 Unauthorized',
    });
    const b = mkFakeProvider({ id: 'b', startBehavior: 'success' });
    const failed = vi.fn();
    const selected = vi.fn();
    const chain = new StreamingSTTChain([a, b], {
      onProviderFailed: failed,
      onProviderSelected: selected,
    });
    const session = await chain.startSession();
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'a', errorClass: 'auth' })
    );
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'b' }));
    expect(chain.currentProviderId).toBe('b');
    await session.close();
  });

  it('throws AggregateVoiceError when all fail', async () => {
    const a = mkFakeProvider({ id: 'a', startBehavior: 'fail' });
    const b = mkFakeProvider({ id: 'b', startBehavior: 'fail' });
    const chain = new StreamingSTTChain([a, b]);
    await expect(chain.startSession()).rejects.toMatchObject({
      name: 'AggregateVoiceError',
    });
  });

  it('respects circuit breaker: skips tripped providers', async () => {
    const { CircuitBreaker } = await import('../CircuitBreaker.js');
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      windowMs: 60_000,
      cooldownMs: 60_000,
    });
    breaker.recordFailure('a', 'auth');
    const a = mkFakeProvider({ id: 'a', startBehavior: 'fail' });
    const b = mkFakeProvider({ id: 'b', startBehavior: 'success' });
    const chain = new StreamingSTTChain([a, b], { breaker });
    const session = await chain.startSession();
    expect(chain.currentProviderId).toBe('b');
    await session.close();
  });

  it('emits provider_selected metric on success', async () => {
    const { VoiceMetricsReporter } = await import('../VoiceMetricsReporter.js');
    const metrics = new VoiceMetricsReporter();
    const received: unknown[] = [];
    metrics.subscribe((e) => received.push(e));
    const a = mkFakeProvider({ id: 'a', startBehavior: 'success' });
    const chain = new StreamingSTTChain([a], { metrics });
    await chain.startSession();
    expect(received[0]).toEqual({
      type: 'provider_selected',
      kind: 'stt',
      providerId: 'a',
      attempt: 1,
    });
  });

  it('exposes providers getter for introspection', () => {
    const a = mkFakeProvider({ id: 'a', startBehavior: 'success', priority: 30 });
    const b = mkFakeProvider({ id: 'b', startBehavior: 'success', priority: 5 });
    const chain = new StreamingSTTChain([a, b]);
    expect(chain.providers.map((p) => p.providerId)).toEqual(['b', 'a']);
  });
});
