import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { AdaptiveVAD, VADResult } from '../../src/core/audio/AdaptiveVAD';
import type { AdaptiveVADConfig } from '../../src/core/audio/AdaptiveVAD';
import type { NoiseProfile } from '../../src/core/audio/EnvironmentalCalibrator';

class InstrumentedCalibrator extends EventEmitter {
  private profile: NoiseProfile | null;
  public voiceActivityNotifications = 0;

  constructor(profile: NoiseProfile | null = null) {
    super();
    this.profile = profile;
  }

  public getCurrentProfile(): NoiseProfile | null {
    return this.profile ? { ...this.profile } : null;
  }

  public setProfile(profile: NoiseProfile): void {
    this.profile = profile;
  }

  public emitProfileUpdate(profile: NoiseProfile): void {
    this.profile = profile;
    this.emit('profile:updated', profile);
  }

  public emitCalibrationComplete(profile: NoiseProfile): void {
    this.profile = profile;
    this.emit('calibration:complete', profile);
  }

  public onVoiceActivityDetected(): void {
    this.voiceActivityNotifications += 1;
  }
}

const buildNoiseProfile = (overrides: Partial<NoiseProfile> = {}): NoiseProfile => ({
  baselineRMS: 0.008,
  peakRMS: 0.018,
  noiseStdDev: 0.0015,
  environmentType: 'quiet',
  confidenceScore: 0.85,
  timestamp: Date.now(),
  suggestedSpeechThreshold: 0.035,
  suggestedSilenceThreshold: 0.011,
  framesAnalyzedCount: 90,
  ...overrides,
});

const createVAD = (
  calibrator: InstrumentedCalibrator,
  config: AdaptiveVADConfig = {},
  profileOverride?: NoiseProfile
): AdaptiveVAD => {
  if (profileOverride) {
    calibrator.setProfile(profileOverride);
  }
  return new AdaptiveVAD(config, calibrator as any, 20);
};

describe('AdaptiveVAD + EnvironmentalCalibrator integration', () => {
  let calibrator: InstrumentedCalibrator;

  beforeEach(() => {
    calibrator = new InstrumentedCalibrator();
  });

  it('reacts to calibrator updates and reports threshold changes', () => {
    const initialProfile = buildNoiseProfile({ suggestedSilenceThreshold: 0.009, suggestedSpeechThreshold: 0.022 });
    const vad = createVAD(calibrator, {}, initialProfile);

    let thresholdsUpdated = 0;
    vad.on('thresholds_updated', (speechThreshold, silenceThreshold, profile) => {
      thresholdsUpdated += 1;
      expect(profile.environmentType).toBe('noisy');
      expect(speechThreshold).toBeGreaterThan(silenceThreshold);
    });

    const noisyProfile = buildNoiseProfile({
      environmentType: 'noisy',
      suggestedSilenceThreshold: 0.03,
      suggestedSpeechThreshold: 0.07,
    });
    calibrator.emitCalibrationComplete(noisyProfile);

    expect(thresholdsUpdated).toBeGreaterThan(0);

    const state = vad.getCurrentState();
    expect(state.silenceThreshold).toBeGreaterThan(initialProfile.suggestedSilenceThreshold);
    expect(state.speechThreshold).toBeGreaterThan(state.silenceThreshold);
  });

  it('emits speech events and notifies calibrator about voice activity', () => {
    const profile = buildNoiseProfile();
    const vad = createVAD(calibrator, { minSpeechDurationMs: 60, maxSilenceDurationMsInSpeech: 80 }, profile);

    const voiceActivity: VADResult[] = [];
    const speechStart: VADResult[] = [];
    const speechEndDurations: number[] = [];

    vad.on('voice_activity', (result) => voiceActivity.push(result));
    vad.on('speech_start', (result) => speechStart.push(result));
    vad.on('speech_end', (_result, duration) => speechEndDurations.push(duration));

    const originalNow = Date.now;
    let simulatedNow = 0;
    (Date as unknown as { now: () => number }).now = () => simulatedNow;

    const pushFrames = (value: number, count: number) => {
      const frame = Float32Array.from({ length: 160 }, () => value);
      for (let i = 0; i < count; i++) {
        simulatedNow += 20;
        vad.processFrame(frame);
      }
    };

    try {
      // Provide a longer sequence of speech frames above threshold to satisfy smoothing and duration
      pushFrames(0.05, 20);

      expect(voiceActivity.length).toBeGreaterThanOrEqual(1);
      expect(speechStart.length).toBeGreaterThan(0);
      expect(calibrator.voiceActivityNotifications).toBeGreaterThan(0);

      // Followed by sufficient silence to end speech
      pushFrames(0.001, 20);

      expect(speechEndDurations.length).toBeGreaterThan(0);
    } finally {
      (Date as unknown as { now: () => number }).now = originalNow;
    }
  });
});
