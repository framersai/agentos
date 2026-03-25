/**
 * @module voice-pipeline/__tests__/voice-e2e.spec
 *
 * End-to-end voice pipeline tests that exercise real API calls.
 *
 * Gated behind `VOICE_E2E=true` so CI does not invoke paid endpoints
 * on every run.  All test suites are skipped when the relevant env
 * vars are absent — zero failures, zero noise.
 *
 * Run with real credentials:
 *   VOICE_E2E=true OPENAI_API_KEY=sk-... \
 *     ./node_modules/.bin/vitest run src/voice-pipeline/__tests__/voice-e2e.spec.ts
 *
 * Verify graceful skip (no credentials):
 *   ./node_modules/.bin/vitest run src/voice-pipeline/__tests__/voice-e2e.spec.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';

/** Master gate — set VOICE_E2E=true to enable all live API tests. */
const hasVoiceE2E = process.env.VOICE_E2E === 'true';

/** OpenAI key is required for TTS + Whisper STT tests. */
const hasOpenAI = !!process.env.OPENAI_API_KEY;

// ============================================================================
// OpenAI TTS + Whisper STT suite
// ============================================================================

describe.skipIf(!hasVoiceE2E || !hasOpenAI)('Voice Pipeline E2E — OpenAI', () => {
  // --------------------------------------------------------------------------
  // Test 1: TTS round-trip
  // --------------------------------------------------------------------------

  it('OpenAI TTS synthesizes valid audio', async () => {
    const { OpenAITextToSpeechProvider } = await import(
      '../../speech/providers/OpenAITextToSpeechProvider.js'
    );

    const tts = new OpenAITextToSpeechProvider({
      apiKey: process.env.OPENAI_API_KEY!,
    });

    const result = await tts.synthesize('Hello, this is a test.', { voice: 'nova' });

    // The result must carry a non-empty audio buffer.
    expect(result.audioBuffer).toBeInstanceOf(Buffer);
    expect(result.audioBuffer.length).toBeGreaterThan(1000); // non-trivial audio

    // MIME type must be in the audio/* family (mp3 by default).
    expect(result.mimeType).toMatch(/^audio\//);
  });

  // --------------------------------------------------------------------------
  // Test 2: STT round-trip — TTS → Whisper → transcript check
  // --------------------------------------------------------------------------

  it(
    'OpenAI Whisper transcribes audio accurately',
    async () => {
      const { OpenAITextToSpeechProvider } = await import(
        '../../speech/providers/OpenAITextToSpeechProvider.js'
      );
      const { OpenAIWhisperSpeechToTextProvider } = await import(
        '../../speech/providers/OpenAIWhisperSpeechToTextProvider.js'
      );

      const tts = new OpenAITextToSpeechProvider({ apiKey: process.env.OPENAI_API_KEY! });
      const stt = new OpenAIWhisperSpeechToTextProvider({ apiKey: process.env.OPENAI_API_KEY! });

      // Synthesize a known phrase as WAV so Whisper can decode it without
      // needing a specific codec.
      const ttsResult = await tts.synthesize(
        'The quick brown fox jumps over the lazy dog.',
        { voice: 'nova', outputFormat: 'wav' }
      );

      expect(ttsResult.audioBuffer.length).toBeGreaterThan(0);

      // Transcribe the synthesized audio back to text.
      const transcript = await stt.transcribe({
        data: ttsResult.audioBuffer,
        fileName: 'test.wav',
        mimeType: 'audio/wav',
      });

      // Verify the key words appear in the transcript.  Exact match is not
      // guaranteed due to TTS prosody vs Whisper decoding variance.
      const text = transcript.text.toLowerCase();
      expect(text).toContain('fox');
      expect(text).toContain('dog');

      // The result must always mark itself as final in batch mode.
      expect(transcript.isFinal).toBe(true);
    },
    30_000 // 30 s — two sequential API calls
  );

  // --------------------------------------------------------------------------
  // Test 3: SpeechProviderResolver recognises OpenAI providers when key is set
  // --------------------------------------------------------------------------

  it('SpeechProviderResolver resolves configured providers', async () => {
    const { SpeechProviderResolver } = await import(
      '../../speech/SpeechProviderResolver.js'
    );

    // Pass the real environment so the resolver can detect OPENAI_API_KEY.
    const resolver = new SpeechProviderResolver(
      undefined,
      process.env as Record<string, string>
    );
    await resolver.refresh();

    const sttProviders = resolver.listProviders('stt');
    const ttsProviders = resolver.listProviders('tts');

    // Both OpenAI providers must appear as configured in the registration list.
    expect(
      sttProviders.some((p) => p.id === 'openai-whisper' && p.isConfigured)
    ).toBe(true);
    expect(
      ttsProviders.some((p) => p.id === 'openai-tts' && p.isConfigured)
    ).toBe(true);

    // resolveSTT() must succeed without throwing when the key is present.
    // The registration stores provider: null as a lazy placeholder — we only
    // verify no exception is thrown and a value is returned.
    expect(() => resolver.resolveSTT()).not.toThrow();
    expect(() => resolver.resolveTTS()).not.toThrow();
  });

  // --------------------------------------------------------------------------
  // Test 4: BuiltInAdaptiveVadProvider processes audio frames
  // --------------------------------------------------------------------------

  it('BuiltInAdaptiveVadProvider processes audio frames without error', async () => {
    const { BuiltInAdaptiveVadProvider } = await import(
      '../../speech/providers/BuiltInAdaptiveVadProvider.js'
    );

    // 16 kHz, 20 ms per frame → 320 samples per frame.
    const FRAME_DURATION_MS = 20;
    const vad = new BuiltInAdaptiveVadProvider({
      sampleRate: 16_000,
      frameDurationMs: FRAME_DURATION_MS,
    });

    // --- Silent frames ---
    // All zeros = no energy → should not be classified as speech.
    const silentFrame = new Float32Array(320).fill(0);

    for (let i = 0; i < 10; i++) {
      const result = vad.processFrame(silentFrame);
      expect(result).toBeDefined();
      // A completely silent frame must never be flagged as speech.
      expect(result.isSpeech).toBe(false);
    }

    // --- "Speech" frames (500 Hz tone at 50 % amplitude) ---
    // These should produce measurable frame energy.
    const speechFrame = new Float32Array(320);
    for (let i = 0; i < 320; i++) {
      speechFrame[i] = Math.sin(i * 0.1) * 0.5;
    }

    const speechDecision = vad.processFrame(speechFrame);
    expect(speechDecision).toBeDefined();

    // The underlying VADResult must expose a positive frame energy.
    expect(speechDecision.result).toBeDefined();
    expect(speechDecision.result!.frameEnergy).toBeGreaterThan(0);

    // Provider reset must not throw.
    expect(() => vad.reset()).not.toThrow();
  });
});

// ============================================================================
// Deepgram batch STT suite (separate API key)
// ============================================================================

/** Deepgram requires OPENAI_API_KEY for TTS audio generation as input. */
const hasDeepgram = !!process.env.DEEPGRAM_API_KEY;

describe.skipIf(!hasVoiceE2E || !hasDeepgram || !hasOpenAI)(
  'Voice Pipeline E2E — Deepgram',
  () => {
    it(
      'Deepgram batch STT transcribes audio',
      async () => {
        const { OpenAITextToSpeechProvider } = await import(
          '../../speech/providers/OpenAITextToSpeechProvider.js'
        );
        const { DeepgramBatchSTTProvider } = await import(
          '../../speech/providers/DeepgramBatchSTTProvider.js'
        );

        // Generate test audio via OpenAI TTS so we have a known phrase.
        const tts = new OpenAITextToSpeechProvider({
          apiKey: process.env.OPENAI_API_KEY!,
        });
        const audio = await tts.synthesize(
          'Hello world, testing Deepgram integration.',
          { voice: 'nova', outputFormat: 'wav' }
        );

        expect(audio.audioBuffer.length).toBeGreaterThan(0);

        // Transcribe via Deepgram batch REST API.
        const stt = new DeepgramBatchSTTProvider({
          apiKey: process.env.DEEPGRAM_API_KEY!,
        });
        const result = await stt.transcribe({
          data: audio.audioBuffer,
          mimeType: 'audio/wav',
        });

        const text = result.text.toLowerCase();

        // Key phrase words must appear in the transcript.
        expect(text).toContain('hello');
        expect(text).toContain('deepgram');

        // Deepgram always marks batch results as final.
        expect(result.isFinal).toBe(true);
      },
      30_000 // 30 s — two sequential API calls
    );
  }
);
