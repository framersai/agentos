import { describe, it, expect, vi } from 'vitest';
import { VoiceMetricsReporter } from '../VoiceMetricsReporter.js';

describe('VoiceMetricsReporter', () => {
  it('fans out events to all subscribers', () => {
    const r = new VoiceMetricsReporter();
    const a = vi.fn();
    const b = vi.fn();
    r.subscribe(a);
    r.subscribe(b);
    r.emit({
      type: 'provider_selected',
      kind: 'stt',
      providerId: 'deepgram',
      attempt: 1,
    });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(a.mock.calls[0][0].providerId).toBe('deepgram');
  });

  it('unsubscribe removes a listener', () => {
    const r = new VoiceMetricsReporter();
    const a = vi.fn();
    const unsub = r.subscribe(a);
    unsub();
    r.emit({
      type: 'provider_failover',
      kind: 'tts',
      from: 'elevenlabs',
      to: 'openai',
      reason: 'network',
      lostMs: 120,
    });
    expect(a).not.toHaveBeenCalled();
  });

  it('swallows listener errors without breaking fan-out', () => {
    const r = new VoiceMetricsReporter();
    const good = vi.fn();
    r.subscribe(() => {
      throw new Error('boom');
    });
    r.subscribe(good);
    r.emit({
      type: 'provider_unavailable',
      kind: 'stt',
      checkedProviders: ['deepgram', 'elevenlabs'],
    });
    expect(good).toHaveBeenCalledOnce();
  });
});
