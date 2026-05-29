import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeechSession } from '../SpeechSession.js';
import type {
  SpeechAudioInput,
  SpeechSynthesisOptions,
  SpeechSynthesisResult,
  SpeechToTextProvider,
  SpeechTranscriptionOptions,
  SpeechTranscriptionResult,
  TextToSpeechProvider,
  WakeWordDetection,
  WakeWordProvider,
} from '../types.js';

/**
 * Mock STT provider that records all transcribe calls for assertion.
 * Returns a fixed transcript for every input.
 */
class MockSttProvider implements SpeechToTextProvider {
  readonly id = 'mock-stt';
  readonly displayName = 'Mock STT';
  /** Collects all audio inputs passed to transcribe(). */
  public readonly calls: SpeechAudioInput[] = [];

  getProviderName(): string {
    return this.displayName;
  }

  async transcribe(
    audio: SpeechAudioInput,
    _options?: SpeechTranscriptionOptions
  ): Promise<SpeechTranscriptionResult> {
    this.calls.push(audio);
    return {
      text: 'mock transcript',
      cost: 0,
      durationSeconds: audio.durationSeconds,
      isFinal: true,
      usage: {
        durationMinutes: (audio.durationSeconds ?? 0) / 60,
        modelUsed: 'mock-stt',
      },
    };
  }
}

/**
 * Mock TTS provider that records all synthesize calls for assertion.
 * Returns a fixed audio buffer for every input.
 */
class MockTtsProvider implements TextToSpeechProvider {
  readonly id = 'mock-tts';
  readonly displayName = 'Mock TTS';
  /** Collects all synthesis requests (text + options). */
  public readonly calls: Array<{ text: string; options?: SpeechSynthesisOptions }> = [];

  getProviderName(): string {
    return this.displayName;
  }

  async synthesize(
    text: string,
    options?: SpeechSynthesisOptions
  ): Promise<SpeechSynthesisResult> {
    this.calls.push({ text, options });
    return {
      audioBuffer: Buffer.from('tts'),
      mimeType: 'audio/mpeg',
      cost: 0,
      voiceUsed: options?.voice,
      providerName: this.displayName,
      usage: {
        characters: text.length,
        modelUsed: 'mock-tts',
      },
    };
  }
}

/**
 * Mock wake-word provider that triggers detection exactly once.
 * After the first detection, subsequent calls return null (no detection).
 */
class MockWakeWordProvider implements WakeWordProvider {
  readonly id = 'mock-wake-word';
  /** Tracks whether the wake word has already fired. */
  private triggered = false;

  async detect(): Promise<WakeWordDetection | null> {
    if (this.triggered) return null;
    this.triggered = true;
    return {
      keyword: 'hey wonderland',
      confidence: 0.91,
      providerId: this.id,
    };
  }

  reset(): void {
    this.triggered = false;
  }
}

/**
 * Tests for {@link SpeechSession} — verifies the end-to-end session lifecycle
 * including VAD-bounded utterance capture, wake-word gating, and TTS synthesis
 * through the configured providers.
 *
 * These tests use fake timers to control the VAD silence detection timing.
 */
describe('SpeechSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should capture a VAD-bounded utterance and auto-transcribe after silence', async () => {
    const stt = new MockSttProvider();
    const session = new SpeechSession(
      {
        mode: 'vad',
        sampleRate: 16_000,
        frameDurationMs: 20,
        vad: {
          minSpeechDurationMs: 40,
          maxSilenceDurationMsInSpeech: 40,
        },
        silence: {
          significantPauseThresholdMs: 40,
          utteranceEndThresholdMs: 80,
          minSilenceTimeToConsiderAfterSpeech: 1,
          silenceCheckIntervalMs: 20,
        },
      },
      { stt }
    );

    const transcripts: string[] = [];
    session.on('transcript_final', (event) => transcripts.push(event.result.text));

    await session.start();

    // Simulate speech frames (high amplitude) followed by silence (near-zero amplitude)
    const speechFrame = Float32Array.from({ length: 320 }, () => 0.2);
    const silenceFrame = Float32Array.from({ length: 320 }, () => 0.0001);

    // Feed 3 speech frames then 3 silence frames
    await session.ingestFrame(speechFrame);
    await session.ingestFrame(speechFrame);
    await session.ingestFrame(speechFrame);
    await session.ingestFrame(silenceFrame);
    await session.ingestFrame(silenceFrame);
    await session.ingestFrame(silenceFrame);

    // Advance timers past the utterance end threshold to trigger transcription
    await vi.advanceTimersByTimeAsync(120);

    // The session should have captured one utterance and transcribed it
    expect(stt.calls).toHaveLength(1);
    expect(transcripts).toEqual(['mock transcript']);
    // After transcription completes, session should return to listening
    expect(session.getState()).toBe('listening');
  });

  it('should gate voice capture behind wake-word detection when in wake-word mode', async () => {
    const session = new SpeechSession(
      {
        mode: 'wake-word',
      },
      {
        wakeWord: new MockWakeWordProvider(),
      }
    );

    const detections: string[] = [];
    session.on('wake_word_detected', (event) => detections.push(event.detection.keyword));

    await session.start();
    // In wake-word mode, the session starts in 'wake-listening' state
    expect(session.getState()).toBe('wake-listening');

    // Ingest a frame to trigger wake-word detection
    await session.ingestFrame(Float32Array.from({ length: 320 }, () => 0.0001));

    // The mock provider triggers on the first frame
    expect(detections).toEqual(['hey wonderland']);
    // After wake-word detection, session transitions to 'listening'
    expect(session.getState()).toBe('listening');
  });

  it('should synthesize speech through the configured TTS provider', async () => {
    const tts = new MockTtsProvider();
    const session = new SpeechSession({}, { tts });

    await session.start();
    const result = await session.speak('Hello there', { voice: 'nova' });

    // Verify the TTS provider was called with the correct text and options
    expect(tts.calls).toHaveLength(1);
    expect(tts.calls[0]).toMatchObject({
      text: 'Hello there',
      options: { voice: 'nova' },
    });
    // The voice used should be reflected in the result
    expect(result.voiceUsed).toBe('nova');
    // After synthesis completes, session should return to listening
    expect(session.getState()).toBe('listening');
  });
});
