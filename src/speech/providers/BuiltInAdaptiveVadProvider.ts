import { AdaptiveVAD } from '../../core/audio/AdaptiveVAD.js';
import { EnvironmentalCalibrator } from '../../core/audio/EnvironmentalCalibrator.js';
import type {
  AdaptiveVADConfig,
} from '../../core/audio/AdaptiveVAD.js';
import type { CalibrationConfig } from '../../core/audio/EnvironmentalCalibrator.js';
import type { SpeechVadDecision, SpeechVadProvider } from '../types.js';

/**
 * Configuration for the {@link BuiltInAdaptiveVadProvider}.
 *
 * All fields are optional — sensible defaults are applied for 16kHz mono
 * audio with 20ms frames (the standard voice pipeline configuration).
 *
 * @see {@link BuiltInAdaptiveVadProvider} for usage examples
 * @see {@link AdaptiveVADConfig} for detailed VAD tuning parameters
 * @see {@link CalibrationConfig} for environmental calibration settings
 */
export interface BuiltInAdaptiveVadProviderConfig {
  /**
   * Audio sample rate in Hz. Must match the actual audio stream.
   * @default 16_000 (16 kHz, standard for voice processing)
   */
  sampleRate?: number;

  /**
   * Duration of each audio frame in milliseconds. Determines the number
   * of samples expected in each `processFrame()` call.
   * At 16kHz with 20ms frames, each frame is 320 samples.
   * @default 20
   */
  frameDurationMs?: number;

  /**
   * Environmental calibration settings. Controls how the noise floor and
   * spectral profile are estimated from ambient audio.
   *
   * @see {@link CalibrationConfig} for available options
   */
  calibration?: CalibrationConfig;

  /**
   * VAD algorithm configuration. Controls speech detection thresholds,
   * minimum speech duration, hangover period, etc.
   *
   * @see {@link AdaptiveVADConfig} for available options
   */
  vad?: AdaptiveVADConfig;
}

/**
 * Built-in voice activity detection (VAD) provider backed by the
 * {@link AdaptiveVAD} engine and {@link EnvironmentalCalibrator}.
 *
 * This is the default VAD provider in AgentOS and requires no external
 * dependencies or API keys. It operates entirely locally on raw audio frames.
 *
 * ## How It Works
 *
 * 1. The {@link EnvironmentalCalibrator} continuously estimates the ambient
 *    noise floor and spectral profile from incoming audio frames.
 * 2. The {@link AdaptiveVAD} uses the calibrator's noise profile to set
 *    dynamic thresholds for speech detection — louder environments get
 *    higher thresholds to avoid false positives.
 * 3. Each `processFrame()` call returns a {@link SpeechVadDecision} with
 *    `isSpeech`, `confidence`, the raw VAD result, and the current noise profile.
 *
 * ## Configuration Defaults
 *
 * - Sample rate: 16 kHz (standard for voice pipelines)
 * - Frame duration: 20ms (320 samples per frame)
 * - VAD and calibration: Use sensible defaults from the underlying engines
 *
 * @see {@link BuiltInAdaptiveVadProviderConfig} for configuration options
 * @see {@link AdaptiveVAD} for the underlying VAD algorithm
 * @see {@link EnvironmentalCalibrator} for the noise profiling engine
 *
 * @example
 * ```ts
 * const vad = new BuiltInAdaptiveVadProvider({
 *   sampleRate: 16_000,
 *   frameDurationMs: 20,
 *   vad: { minSpeechDurationMs: 100 },
 * });
 *
 * const frame = new Float32Array(320); // 20ms at 16kHz
 * // ... fill frame with audio samples ...
 * const decision = vad.processFrame(frame);
 * if (decision.isSpeech) {
 *   console.log(`Speech detected (confidence: ${decision.confidence})`);
 * }
 * ```
 */
export class BuiltInAdaptiveVadProvider implements SpeechVadProvider {
  /** Unique provider identifier used for registration and resolution. */
  public readonly id = 'agentos-adaptive-vad';

  /** Human-readable display name for UI and logging. */
  public readonly displayName = 'AgentOS Adaptive VAD';

  /**
   * Environmental calibrator that estimates the ambient noise profile.
   * Shared with the VAD engine for dynamic threshold adaptation.
   */
  private readonly calibrator: EnvironmentalCalibrator;

  /**
   * Adaptive VAD engine that performs frame-by-frame speech detection
   * using the calibrator's noise profile for dynamic thresholding.
   */
  private readonly vad: AdaptiveVAD;

  /**
   * Creates a new BuiltInAdaptiveVadProvider.
   *
   * Initializes both the environmental calibrator and the adaptive VAD
   * engine with the provided or default configuration.
   *
   * @param config - Optional VAD configuration. All fields default to
   *   standard values suitable for 16kHz mono voice audio.
   *
   * @example
   * ```ts
   * // Default configuration (16kHz, 20ms frames)
   * const vad = new BuiltInAdaptiveVadProvider();
   *
   * // Custom configuration
   * const vad = new BuiltInAdaptiveVadProvider({
   *   sampleRate: 48_000,
   *   frameDurationMs: 10,
   *   vad: { minSpeechDurationMs: 200 },
   * });
   * ```
   */
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

  /**
   * Process a single audio frame and return a speech/non-speech decision.
   *
   * This method must be called sequentially with consecutive audio frames.
   * The VAD maintains internal state (speech onset tracking, hangover counters)
   * that depends on temporal continuity between frames.
   *
   * @param frame - A Float32Array of audio samples for one frame. The expected
   *   length is `sampleRate * frameDurationMs / 1000` (e.g. 320 for 16kHz/20ms).
   *   Samples should be normalized to the range [-1.0, 1.0].
   * @returns A decision object with `isSpeech`, `confidence`, the raw VAD result,
   *   and the current environmental noise profile.
   *
   * @example
   * ```ts
   * const frame = new Float32Array(320);
   * // ... fill with audio samples ...
   * const decision = vad.processFrame(frame);
   * console.log(decision.isSpeech, decision.confidence);
   * ```
   */
  processFrame(frame: Float32Array): SpeechVadDecision {
    const result = this.vad.processFrame(frame);
    return {
      isSpeech: result.isSpeech,
      confidence: result.confidence,
      result,
      profile: this.calibrator.getCurrentProfile(),
    };
  }

  /**
   * Reset the VAD state for a new audio session.
   *
   * Clears internal counters (speech onset tracking, hangover timers) so the
   * VAD starts fresh. Should be called when starting a new conversation turn
   * or after a significant audio gap. Does NOT reset the environmental
   * calibrator — the noise profile persists across resets.
   *
   * @example
   * ```ts
   * // Start a new conversation turn
   * vad.reset();
   * ```
   */
  reset(): void {
    this.vad.resetState();
  }

  /**
   * Returns the current environmental noise profile estimated by the calibrator.
   *
   * The noise profile includes the estimated noise floor RMS, spectral shape,
   * and confidence metrics. Returns `null` if insufficient audio has been
   * processed for a reliable estimate.
   *
   * @returns The current noise profile, or `null` if not yet calibrated.
   *
   * @example
   * ```ts
   * const profile = vad.getNoiseProfile();
   * if (profile) {
   *   console.log(`Noise floor: ${profile.noiseFloorRms}`);
   * }
   * ```
   */
  getNoiseProfile() {
    return this.calibrator.getCurrentProfile();
  }
}
