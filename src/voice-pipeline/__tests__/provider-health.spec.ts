import { describe, it, expect } from 'vitest';
import { DeepgramStreamingSTT } from '../providers/DeepgramStreamingSTT.js';
import { ElevenLabsStreamingSTT } from '../providers/ElevenLabsStreamingSTT.js';
import { ElevenLabsStreamingTTS } from '../providers/ElevenLabsStreamingTTS.js';
import { OpenAIRealtimeTTS } from '../providers/OpenAIRealtimeTTS.js';
import { ElevenLabsBatchTTS } from '../providers/ElevenLabsBatchTTS.js';
import { OpenAIBatchTTS } from '../providers/OpenAIBatchTTS.js';

describe('provider HealthyProvider implementations', () => {
  it('Deepgram exposes capabilities + priority', () => {
    const p = new DeepgramStreamingSTT({ apiKey: 'test' });
    expect(p.providerId).toBe('deepgram-streaming');
    expect(p.priority).toBeGreaterThanOrEqual(0);
    expect(p.capabilities.streaming).toBe(true);
    expect(p.capabilities.latencyClass).toBe('realtime');
  });

  it('ElevenLabs STT reports near-realtime latency (chunked REST)', () => {
    const p = new ElevenLabsStreamingSTT({ apiKey: 'test' });
    expect(p.providerId).toBe('elevenlabs-streaming-stt');
    expect(p.capabilities.latencyClass).toBe('near-realtime');
  });

  it('ElevenLabs streaming TTS capabilities', () => {
    const p = new ElevenLabsStreamingTTS({ apiKey: 'test' });
    expect(p.providerId).toBe('elevenlabs-streaming');
    expect(p.capabilities.streaming).toBe(true);
  });

  it('OpenAI Realtime TTS capabilities', () => {
    const p = new OpenAIRealtimeTTS({ apiKey: 'test' });
    expect(p.providerId).toBe('openai-realtime');
    expect(p.capabilities.streaming).toBe(true);
  });

  it('ElevenLabs Batch TTS is non-streaming', () => {
    const p = new ElevenLabsBatchTTS({ apiKey: 'test' });
    expect(p.providerId).toBe('elevenlabs-batch');
    expect(p.capabilities.streaming).toBe(false);
    expect(p.capabilities.latencyClass).toBe('batch');
  });

  it('OpenAI Batch TTS is non-streaming', () => {
    const p = new OpenAIBatchTTS({ apiKey: 'test' });
    expect(p.providerId).toMatch(/^openai-/);
    expect(p.capabilities.streaming).toBe(false);
    expect(p.capabilities.latencyClass).toBe('batch');
  });

  it('healthCheck returns auth failure on 401 from probe', async () => {
    const p = new ElevenLabsStreamingTTS({
      apiKey: 'bogus',
      healthProbe: async () => ({ ok: false, status: 401, latencyMs: 50 }),
    });
    const result = await p.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.error?.class).toBe('auth');
  });

  it('healthCheck returns ok when probe succeeds', async () => {
    const p = new ElevenLabsStreamingTTS({
      apiKey: 'valid',
      healthProbe: async () => ({ ok: true, status: 200, latencyMs: 30 }),
    });
    const result = await p.healthCheck();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBe(30);
  });

  it('healthCheck catches thrown errors (network)', async () => {
    const p = new DeepgramStreamingSTT({
      apiKey: 'valid',
      healthProbe: async () => {
        throw Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });
      },
    });
    const result = await p.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.error?.class).toBe('network');
  });
});
