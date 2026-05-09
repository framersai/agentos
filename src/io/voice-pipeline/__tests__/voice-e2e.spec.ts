/**
 * @module voice-pipeline/__tests__/voice-e2e.spec
 *
 * End-to-end voice pipeline tests that exercise real API calls.
 *
 * Gated behind `VOICE_E2E=true` so CI does not invoke paid endpoints
 * on every run. All test suites are skipped when the relevant env
 * vars are absent -- zero failures, zero noise.
 *
 * ## Running with real credentials
 *
 * ```bash
 * VOICE_E2E=true OPENAI_API_KEY=sk-... \
 *   ./node_modules/.bin/vitest run src/voice-pipeline/__tests__/voice-e2e.spec.ts
 * ```
 *
 * ## Verifying graceful skip (no credentials)
 *
 * ```bash
 * ./node_modules/.bin/vitest run src/voice-pipeline/__tests__/voice-e2e.spec.ts
 * ```
 *
 * ## What is tested (when credentials are present)
 *
 * 1. OpenAI TTS synthesizes valid audio (non-trivial buffer, audio/* MIME type)
 * 2. OpenAI Whisper transcribes TTS output accurately (round-trip: TTS -> WAV -> STT)
 * 3. SpeechProviderResolver detects configured OpenAI providers
 * 4. BuiltInAdaptiveVadProvider processes silent and speech-like frames correctly
 * 5. Deepgram batch STT transcribes audio (separate API key gate)
 */

import { describe, it, expect, beforeAll } from 'vitest';

/** Master gate -- set VOICE_E2E=true to enable all live API tests. */
const hasVoiceE2E = process.env.VOICE_E2E === 'true';

/** OpenAI key is required for TTS + Whisper STT tests. */
const hasOpenAI = !!process.env.OPENAI_API_KEY;

// ============================================================================
// OpenAI TTS + Whisper STT suite
// ============================================================================

describe.skipIf(!hasVoiceE2E || !hasOpenAI)('Voice Pipeline E2E -- OpenAI', () => {
  // --------------------------------------------------------------------------
  // Test 1: TTS round-trip -- verify audio synthesis produces valid output
  // --------------------------------------------------------------------------

  it('should synthesize valid audio via OpenAI TTS', async () => {
    const { OpenAITextToSpeechProvider } = await import(
      '../../speech/providers/OpenAITextToSpeechProvider.js'
    );

    const tts = new OpenAITextToSpeechProvider({
      apiKey: process.env.OPENAI_API_KEY!,
    });

    const result = await tts.synthesize('Hello, this is a test.', { voice: 'nova' });

    // The result must carry a non-empty audio buffer (> 1 KB for real audio)
    expect(result.audioBuffer).toBeInstanceOf(Buffer);
    expect(result.audioBuffer.length).toBeGreaterThan(1000);

    // MIME type must be in the audio/* family (mp3 by default)
    expect(result.mimeType).toMatch(/^audio\//);
  });

  // --------------------------------------------------------------------------
  // Test 2: TTS -> Whisper round-trip -- verify transcription accuracy
  // --------------------------------------------------------------------------

  /**
   * Synthesizes a known phrase via TTS, then transcribes it via Whisper.
   * Key words (not exact text) are checked to account for TTS prosody
   * and STT decoding variance.
   */
  it(
    'should accurately transcribe TTS audio via OpenAI Whisper',
    async () => {
      const { OpenAITextToSpeechProvider } = await import(
        '../../speech/providers/OpenAITextToSpeechProvider.js'
      );
      const { OpenAIWhisperSpeechToTextProvider } = await import(
        '../../hearing/providers/OpenAIWhisperSpeechToTextProvider.js'
      );

      const tts = new OpenAITextToSpeechProvider({ apiKey: process.env.OPENAI_API_KEY! });
      const stt = new OpenAIWhisperSpeechToTextProvider({ apiKey: process.env.OPENAI_API_KEY! });

      // Synthesize as WAV so Whisper can decode without a specific codec
      const ttsResult = await tts.synthesize(
        'The quick brown fox jumps over the lazy dog.',
        { voice: 'nova', outputFormat: 'wav' }
      );

      expect(ttsResult.audioBuffer.length).toBeGreaterThan(0);

      // Transcribe the synthesized audio back to text
      const transcript = await stt.transcribe({
        data: ttsResult.audioBuffer,
        fileName: 'test.wav',
        mimeType: 'audio/wav',
      });

      // Verify key words appear (exact match not guaranteed due to variance)
      const text = transcript.text.toLowerCase();
      expect(text).toContain('fox');
      expect(text).toContain('dog');

      // Batch mode always marks results as final
      expect(transcript.isFinal).toBe(true);
    },
    30_000 // 30 s timeout -- two sequential API calls
  );

  // --------------------------------------------------------------------------
  // Test 3: SpeechProviderResolver detects configured providers
  // --------------------------------------------------------------------------

  it('should resolve configured OpenAI STT and TTS providers', async () => {
    const { SpeechProviderResolver } = await import(
      '../../speech/SpeechProviderResolver.js'
    );

    // Pass the real environment so the resolver can detect OPENAI_API_KEY
    const resolver = new SpeechProviderResolver(
      undefined,
      process.env as Record<string, string>
    );
    await resolver.refresh();

    const sttProviders = resolver.listProviders('stt');
    const ttsProviders = resolver.listProviders('tts');

    // Both OpenAI providers must appear as configured
    expect(
      sttProviders.some((p) => p.id === 'openai-whisper' && p.isConfigured)
    ).toBe(true);
    expect(
      ttsProviders.some((p) => p.id === 'openai-tts' && p.isConfigured)
    ).toBe(true);

    // resolveSTT/TTS should not throw when the key is present
    expect(() => resolver.resolveSTT()).not.toThrow();
    expect(() => resolver.resolveTTS()).not.toThrow();
  });

  // --------------------------------------------------------------------------
  // Test 4: BuiltInAdaptiveVadProvider processes audio frames correctly
  // --------------------------------------------------------------------------

  /**
   * Validates that the VAD provider correctly classifies silent frames as
   * non-speech and synthetic tone frames as having measurable energy.
   * No real microphone is involved.
   */
  it('should process audio frames correctly via BuiltInAdaptiveVadProvider', async () => {
    const { BuiltInAdaptiveVadProvider } = await import(
      '../../hearing/providers/BuiltInAdaptiveVadProvider.js'
    );

    // 16 kHz, 20 ms per frame = 320 samples per frame
    const FRAME_DURATION_MS = 20;
    const vad = new BuiltInAdaptiveVadProvider({
      sampleRate: 16_000,
      frameDurationMs: FRAME_DURATION_MS,
    });

    // --- Silent frames (all zeros = no energy) ---
    const silentFrame = new Float32Array(320).fill(0);
    for (let i = 0; i < 10; i++) {
      const result = vad.processFrame(silentFrame);
      expect(result).toBeDefined();
      // Completely silent frames must never be flagged as speech
      expect(result.isSpeech).toBe(false);
    }

    // --- Synthetic "speech" frames (500 Hz tone at 50% amplitude) ---
    const speechFrame = new Float32Array(320);
    for (let i = 0; i < 320; i++) {
      speechFrame[i] = Math.sin(i * 0.1) * 0.5;
    }

    const speechDecision = vad.processFrame(speechFrame);
    expect(speechDecision).toBeDefined();

    // The VADResult must expose positive frame energy for the synthetic tone
    expect(speechDecision.result).toBeDefined();
    expect(speechDecision.result!.frameEnergy).toBeGreaterThan(0);

    // Provider reset must not throw
    expect(() => vad.reset()).not.toThrow();
  });
});

// ============================================================================
// Deepgram batch STT suite (separate API key)
// ============================================================================

/** Deepgram requires OPENAI_API_KEY for TTS audio generation as input. */
const hasDeepgram = !!process.env.DEEPGRAM_API_KEY;

describe.skipIf(!hasVoiceE2E || !hasDeepgram || !hasOpenAI)(
  'Voice Pipeline E2E -- Deepgram',
  () => {
    /**
     * Generates test audio via OpenAI TTS (known phrase), then transcribes
     * it via Deepgram's batch REST API. Key words are checked for accuracy.
     */
    it(
      'should transcribe TTS audio via Deepgram batch STT',
      async () => {
        const { OpenAITextToSpeechProvider } = await import(
          '../../speech/providers/OpenAITextToSpeechProvider.js'
        );
        const { DeepgramBatchSTTProvider } = await import(
          '../../hearing/providers/DeepgramBatchSTTProvider.js'
        );

        // Generate test audio via OpenAI TTS with a known phrase
        const tts = new OpenAITextToSpeechProvider({
          apiKey: process.env.OPENAI_API_KEY!,
        });
        const audio = await tts.synthesize(
          'Hello world, testing Deepgram integration.',
          { voice: 'nova', outputFormat: 'wav' }
        );

        expect(audio.audioBuffer.length).toBeGreaterThan(0);

        // Transcribe via Deepgram batch REST API
        const stt = new DeepgramBatchSTTProvider({
          apiKey: process.env.DEEPGRAM_API_KEY!,
        });
        const result = await stt.transcribe({
          data: audio.audioBuffer,
          mimeType: 'audio/wav',
        });

        const text = result.text.toLowerCase();

        // Key phrase words must appear in the transcript
        expect(text).toContain('hello');
        expect(text).toContain('deepgram');

        // Deepgram always marks batch results as final
        expect(result.isFinal).toBe(true);
      },
      30_000 // 30 s timeout -- two sequential API calls
    );
  }
);
