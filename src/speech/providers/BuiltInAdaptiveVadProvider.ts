import { AdaptiveVAD } from '../../core/audio/AdaptiveVAD.js';
import { EnvironmentalCalibrator } from '../../core/audio/EnvironmentalCalibrator.js';
import type {
  AdaptiveVADConfig,
} from '../../core/audio/AdaptiveVAD.js';
import type { CalibrationConfig } from '../../core/audio/EnvironmentalCalibrator.js';
import type { SpeechVadDecision, SpeechVadProvider } from '../types.js';

export interface BuiltInAdaptiveVadProviderConfig {
  sampleRate?: number;
  frameDurationMs?: number;
  calibration?: CalibrationConfig;
  vad?: AdaptiveVADConfig;
}

export class BuiltInAdaptiveVadProvider implements SpeechVadProvider {
  public readonly id = 'agentos-adaptive-vad';
  public readonly displayName = 'AgentOS Adaptive VAD';
  private readonly calibrator: EnvironmentalCalibrator;
  private readonly vad: AdaptiveVAD;

  constructor(config: BuiltInAdaptiveVadProviderConfig = {}) {
    this.calibrator = new EnvironmentalCalibrator({
      sampleRate: config.sampleRate ?? 16_000,
      ...(config.calibration ?? {}),
    });
    this.vad = new AdaptiveVAD(
      config.vad ?? {},
      this.calibrator,
      config.frameDurationMs ?? 20
    );
  }

  processFrame(frame: Float32Array): SpeechVadDecision {
    const result = this.vad.processFrame(frame);
    return {
      isSpeech: result.isSpeech,
      confidence: result.confidence,
      result,
      profile: this.calibrator.getCurrentProfile(),
    };
  }

  reset(): void {
    this.vad.resetState();
  }

  getNoiseProfile() {
    return this.calibrator.getCurrentProfile();
  }
}
