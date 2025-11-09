import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { AdaptiveVAD } from '../../src/core/audio/AdaptiveVAD';
import type { NoiseProfile } from '../../src/core/audio/EnvironmentalCalibrator';

class E2ECalibrator extends EventEmitter {
  constructor(private profile: NoiseProfile) {
    super();
  }

  public getCurrentProfile(): NoiseProfile {
    return { ...this.profile };
  }

  public onVoiceActivityDetected(): void {
    // no-op for e2e scenario
  }
}

const baseProfile: NoiseProfile = {
  baselineRMS: 0.01,
  peakRMS: 0.04,
  noiseStdDev: 0.002,
  environmentType: 'normal',
  confidenceScore: 0.8,
  timestamp: Date.now(),
  suggestedSpeechThreshold: 0.045,
  suggestedSilenceThreshold: 0.015,
  framesAnalyzedCount: 200,
};

const createFrame = (value: number): Float32Array =>
  Float32Array.from({ length: 320 }, () => value);

describe('AdaptiveVAD end-to-end speech detection', () => {
  it('detects a full speech segment and reports correct lifecycle events', () => {
    const calibrator = new E2ECalibrator(baseProfile);
    const vad = new AdaptiveVAD({ minSpeechDurationMs: 60, maxSilenceDurationMsInSpeech: 80 }, calibrator as any, 20);

    const events: Array<{ type: string; payload: unknown }> = [];

    vad.on('speech_start', (result) => events.push({ type: 'speech_start', payload: result }));
    vad.on('voice_activity', (result) => events.push({ type: 'voice_activity', payload: result }));
    vad.on('no_voice_activity', (result) => events.push({ type: 'no_voice_activity', payload: result }));
    vad.on('speech_end', (_result, duration) => events.push({ type: 'speech_end', payload: duration }));

    const originalNow = Date.now;
    let simulatedNow = 0;
    (Date as unknown as { now: () => number }).now = () => simulatedNow;

    const feedFrames = (value: number, count: number) => {
      const frame = createFrame(value);
      for (let i = 0; i < count; i++) {
        simulatedNow += 20;
        vad.processFrame(frame);
      }
    };

    try {
      // Prime with brief silence (no speech)
      feedFrames(0.001, 5);

      // Speech burst with a decently long segment
      feedFrames(0.06, 30);

      // Pause shorter than max silence to keep segment active
      feedFrames(0.002, 3);

      // Resume speech to extend the segment
      feedFrames(0.06, 15);

      // Final silence to trigger speech end
      feedFrames(0.001, 20);

      const eventTypes = events.map((evt) => evt.type);
      expect(eventTypes).toContain('speech_start');
      expect(eventTypes).toContain('speech_end');

      const speechEndDuration = events.find((evt) => evt.type === 'speech_end')?.payload as number | undefined;
      expect(typeof speechEndDuration).toBe('number');
      expect(speechEndDuration).toBeGreaterThan(0);

      const speechStartIndex = eventTypes.indexOf('speech_start');
      const speechEndIndex = eventTypes.lastIndexOf('speech_end');
      expect(speechStartIndex).toBeLessThan(speechEndIndex);
    } finally {
      (Date as unknown as { now: () => number }).now = originalNow;
    }
  });
});
