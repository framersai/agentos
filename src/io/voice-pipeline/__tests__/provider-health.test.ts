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

  it('ElevenLabs chunked STT POST body uses multipart name="file" (not "audio")', async () => {
    // Regression for the 2026-05-20 voice failure: the previous body used
    // name="audio" and every chunk got HTTP 400 from `/v1/speech-to-text`
    // with `{ param: 'file' }`. Asserting on the wire shape so a rename
    // would surface here before reaching production.
    const originalFetch = globalThis.fetch;
    let capturedBody = '';
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const buf = Buffer.isBuffer(init.body)
        ? (init.body as Buffer)
        : Buffer.from(init.body as ArrayBuffer);
      capturedBody = buf.toString('binary');
      return new Response(
        JSON.stringify({ text: 'hello', words: [], language_code: 'en' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;

    try {
      const stt = new ElevenLabsStreamingSTT({ apiKey: 'test' });
      const session = await stt.startSession({ language: 'en' });
      const samples = new Float32Array(16000);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = i % 2 === 0 ? 0.5 : -0.5;
      }
      session.pushAudio({
        samples,
        sampleRate: 16000,
        timestamp: 0,
      });
      await session.flush();

      expect(capturedBody).toContain('name="file"');
      expect(capturedBody).toContain('filename="audio.wav"');
      expect(capturedBody).not.toContain('name="audio"');
      session.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
