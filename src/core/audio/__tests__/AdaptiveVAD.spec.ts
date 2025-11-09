import { describe, it, expect, beforeEach } from 'vitest';
import { AdaptiveVAD, AdaptiveVADConfig, VADResult } from '../AdaptiveVAD';
import type { NoiseProfile } from '../EnvironmentalCalibrator';
import { EventEmitter } from 'events';

class StubCalibrator extends EventEmitter {
  private profile: NoiseProfile | null;

  constructor(profile: NoiseProfile | null = null) {
    super();
    this.profile = profile;
  }

  public setProfile(profile: NoiseProfile): void {
    this.profile = profile;
  }

  public getCurrentProfile(): NoiseProfile | null {
    return this.profile ? { ...this.profile } : null;
  }

  public onVoiceActivityDetected(): void {
    // no-op for tests
  }

  public emitProfileUpdate(profile: NoiseProfile): void {
    this.profile = profile;
    this.emit('profile:updated', profile);
  }

  public emitCalibrationComplete(profile: NoiseProfile): void {
    this.profile = profile;
    this.emit('calibration:complete', profile);
  }
}

const createNoiseProfile = (overrides: Partial<NoiseProfile> = {}): NoiseProfile => ({
  baselineRMS: 0.01,
  peakRMS: 0.03,
  noiseStdDev: 0.002,
  environmentType: 'normal',
  confidenceScore: 0.9,
  timestamp: Date.now(),
  suggestedSpeechThreshold: 0.04,
  suggestedSilenceThreshold: 0.012,
  framesAnalyzedCount: 128,
  ...overrides,
});

describe('AdaptiveVAD', () => {
  let calibrator: StubCalibrator;
  const frameDurationMs = 20;

  beforeEach(() => {
    calibrator = new StubCalibrator();
  });

  const createVAD = (config: AdaptiveVADConfig = {}, profile?: NoiseProfile): AdaptiveVAD => {
    if (profile) {
      calibrator.setProfile(profile);
    }
    return new AdaptiveVAD(config, calibrator as any, frameDurationMs);
  };

  it('initialises thresholds from calibrator profile when available', () => {
    const profile = createNoiseProfile({ suggestedSilenceThreshold: 0.02, suggestedSpeechThreshold: 0.05 });
    const vad = createVAD({}, profile);

    const state = vad.getCurrentState();
    expect(state.silenceThreshold).toBeGreaterThan(0);
    expect(state.speechThreshold).toBeGreaterThan(state.silenceThreshold);
  });

  it('falls back to sane defaults when no profile exists', () => {
    const vad = createVAD();
    const state = vad.getCurrentState();
    expect(state.silenceThreshold).toBeGreaterThan(0);
    expect(state.speechThreshold).toBeGreaterThan(state.silenceThreshold);
  });

  it('updates thresholds when calibrator emits profile updates', () => {
    const initialProfile = createNoiseProfile({ suggestedSilenceThreshold: 0.01, suggestedSpeechThreshold: 0.03 });
    const vad = createVAD({}, initialProfile);

    const updatedProfile = createNoiseProfile({
      suggestedSilenceThreshold: 0.04,
      suggestedSpeechThreshold: 0.1,
      environmentType: 'noisy',
    });

    calibrator.emitProfileUpdate(updatedProfile);

    const state = vad.getCurrentState();
    expect(state.silenceThreshold).toBeGreaterThanOrEqual(updatedProfile.suggestedSilenceThreshold);
    expect(state.speechThreshold).toBeGreaterThan(state.silenceThreshold);
  });

  it('emits speech events when energy crosses thresholds', () => {
    const profile = createNoiseProfile({ suggestedSilenceThreshold: 0.01, suggestedSpeechThreshold: 0.025 });
    const vad = createVAD({ minSpeechDurationMs: 40 }, profile); // Two frames required

    const speechEvents: VADResult[] = [];
    vad.on('speech_start', (result) => speechEvents.push(result));

    // Frame below threshold (silence)
    vad.processFrame(Float32Array.from({ length: 160 }, () => 0.002));
    expect(speechEvents.length).toBe(0);

    // Frames above threshold to trigger speech start
    vad.processFrame(Float32Array.from({ length: 160 }, () => 0.05));
    vad.processFrame(Float32Array.from({ length: 160 }, () => 0.05));

    expect(speechEvents.length).toBeGreaterThan(0);
    speechEvents.forEach((event) => {
      expect(event.isSpeech).toBe(true);
      expect(event.frameEnergy).toBeGreaterThan(event.currentSilenceThreshold);
    });
  });
});

