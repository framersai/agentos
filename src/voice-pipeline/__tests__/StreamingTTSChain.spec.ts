import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { StreamingTTSChain } from '../providers/StreamingTTSChain.js';
import { defaultCapabilities } from '../HealthyProvider.js';
import type { IStreamingTTS, StreamingTTSSession } from '../types.js';
import type { HealthyProvider } from '../HealthyProvider.js';

function mkSession(providerId: string) {
  const ee = new EventEmitter() as unknown as StreamingTTSSession & {
    _tokens: string[];
    _flushed: number;
    providerId: string;
  };
  (ee as any).providerId = providerId;
  (ee as any)._tokens = [];
  (ee as any)._flushed = 0;
  (ee as any).pushTokens = (t: string) => {
    (ee as any)._tokens.push(t);
  };
  (ee as any).flush = async () => {
    (ee as any)._flushed += 1;
  };
  (ee as any).cancel = () => {};
  (ee as any).close = () => {};
  return ee;
}

function mkFakeTTS(opts: {
  id: string;
  priority?: number;
  behavior: 'success' | 'fail';
  msg?: string;
}): IStreamingTTS & HealthyProvider {
  return {
    providerId: opts.id,
    priority: opts.priority ?? 10,
    capabilities: defaultCapabilities({ streaming: true }),
    async startSession() {
      if (opts.behavior === 'fail') throw new Error(opts.msg ?? 'fail');
      return mkSession(opts.id);
    },
    async healthCheck() {
      return { ok: true };
    },
  } as IStreamingTTS & HealthyProvider;
}

describe('StreamingTTSChain — init-time fallback', () => {
  it('selects the first healthy provider', async () => {
    const a = mkFakeTTS({ id: 'eleven', behavior: 'success', priority: 10 });
    const b = mkFakeTTS({ id: 'openai', behavior: 'success', priority: 20 });
    const chain = new StreamingTTSChain([a, b]);
    const s = await chain.startSession();
    expect(chain.currentProviderId).toBe('eleven');
    s.close();
  });

  it('falls back when primary throws', async () => {
    const a = mkFakeTTS({
      id: 'eleven',
      behavior: 'fail',
      msg: '503 Service Unavailable',
    });
    const b = mkFakeTTS({ id: 'openai', behavior: 'success' });
    const chain = new StreamingTTSChain([a, b]);
    const s = await chain.startSession();
    expect(chain.currentProviderId).toBe('openai');
    s.close();
  });

  it('throws AggregateVoiceError when all fail', async () => {
    const a = mkFakeTTS({ id: 'eleven', behavior: 'fail' });
    const b = mkFakeTTS({ id: 'openai', behavior: 'fail' });
    const chain = new StreamingTTSChain([a, b]);
    await expect(chain.startSession()).rejects.toMatchObject({
      name: 'AggregateVoiceError',
    });
  });

  it('sorts providers by priority', async () => {
    const a = mkFakeTTS({ id: 'a', behavior: 'success', priority: 30 });
    const b = mkFakeTTS({ id: 'b', behavior: 'success', priority: 5 });
    const chain = new StreamingTTSChain([a, b]);
    const s = await chain.startSession();
    expect(chain.currentProviderId).toBe('b');
    s.close();
  });
});

describe('StreamingTTSChain — mid-synthesis failover', () => {
  it('re-sends accumulated tokens to the backup when primary errors', async () => {
    // Primary accepts tokens, then emits error before flush.
    let aSessionRef: any;
    const a: IStreamingTTS & HealthyProvider = {
      providerId: 'a',
      priority: 10,
      capabilities: defaultCapabilities({ streaming: true }),
      async startSession() {
        const s = mkSession('a');
        aSessionRef = s;
        return s;
      },
      async healthCheck() {
        return { ok: true };
      },
    } as any;

    let bSessionRef: any;
    const b: IStreamingTTS & HealthyProvider = {
      providerId: 'b',
      priority: 20,
      capabilities: defaultCapabilities({ streaming: true }),
      async startSession() {
        const s = mkSession('b');
        bSessionRef = s;
        return s;
      },
      async healthCheck() {
        return { ok: true };
      },
    } as any;

    const failover = vi.fn();
    const chain = new StreamingTTSChain([a, b], {
      enableMidSynthesisFailover: true,
      onProviderFailover: failover,
    });
    const session = await chain.startSession();
    session.pushTokens('Hello ');
    session.pushTokens('world.');

    // Force primary to error, which should trigger failover to b.
    (aSessionRef as EventEmitter).emit('error', new Error('ECONNRESET'));
    // Give the microtask queue time to run the failover.
    await new Promise((r) => setTimeout(r, 30));

    expect(failover).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'a', to: 'b', kind: 'tts' })
    );
    // Backup should have received the replayed tokens (joined or in order).
    expect(bSessionRef._tokens.join('')).toContain('Hello world.');
    session.close();
  });
});
