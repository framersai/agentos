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

class MockSttProvider implements SpeechToTextProvider {
  readonly id = 'mock-stt';
  readonly displayName = 'Mock STT';
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

class MockTtsProvider implements TextToSpeechProvider {
  readonly id = 'mock-tts';
  readonly displayName = 'Mock TTS';
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

class MockWakeWordProvider implements WakeWordProvider {
  readonly id = 'mock-wake-word';
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

describe('SpeechSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures a VAD-bounded utterance and transcribes it after silence', async () => {
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

    const speechFrame = Float32Array.from({ length: 320 }, () => 0.2);
    const silenceFrame = Float32Array.from({ length: 320 }, () => 0.0001);

    await session.ingestFrame(speechFrame);
    await session.ingestFrame(speechFrame);
    await session.ingestFrame(speechFrame);
    await session.ingestFrame(silenceFrame);
    await session.ingestFrame(silenceFrame);
    await session.ingestFrame(silenceFrame);

    await vi.advanceTimersByTimeAsync(120);

    expect(stt.calls).toHaveLength(1);
    expect(transcripts).toEqual(['mock transcript']);
    expect(session.getState()).toBe('listening');
  });

  it('gates voice capture behind wake-word detection when configured', async () => {
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
    expect(session.getState()).toBe('wake-listening');

    await session.ingestFrame(Float32Array.from({ length: 320 }, () => 0.0001));

    expect(detections).toEqual(['hey wonderland']);
    expect(session.getState()).toBe('listening');
  });

  it('synthesizes speech through the configured TTS provider', async () => {
    const tts = new MockTtsProvider();
    const session = new SpeechSession({}, { tts });

    await session.start();
    const result = await session.speak('Hello there', { voice: 'nova' });

    expect(tts.calls).toHaveLength(1);
    expect(tts.calls[0]).toMatchObject({
      text: 'Hello there',
      options: { voice: 'nova' },
    });
    expect(result.voiceUsed).toBe('nova');
    expect(session.getState()).toBe('listening');
  });
});
