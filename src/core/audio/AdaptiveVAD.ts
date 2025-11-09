// backend/agentos/core/audio/AdaptiveVAD.ts

import { EventEmitter } from 'events';
import { EnvironmentalCalibrator, NoiseProfile } from './EnvironmentalCalibrator';

/**
 * @fileoverview Adaptive Voice Activity Detection (VAD) system for Node.js.
 * This module processes raw audio frames and uses an environmental noise profile
 * to dynamically adjust its sensitivity for detecting speech.
 * It does NOT rely on browser Web Audio APIs.
 * @module agentos/core/audio/AdaptiveVAD
 */

/**
 * Represents the result of VAD processing for an audio frame.
 */
export interface VADResult {
  /** Indicates whether speech is currently detected in the frame. */
  isSpeech: boolean;
  /** The calculated energy (RMS) of the current audio frame. */
  frameEnergy: number;
  /** The speech detection threshold used for this frame, adapted from the noise profile. */
  currentSpeechThreshold: number;
  /** The silence detection threshold used for this frame. */
  currentSilenceThreshold: number;
  /** Confidence score (0-1) in the `isSpeech` detection. Can be basic for now. */
  confidence?: number; // Optional for initial implementation
}

/**
 * Events emitted by the AdaptiveVAD.
 */
export interface VADEmitterEvents {
  /** Emitted when speech segment starts after a period of silence. Contains the VADResult. */
  'speech_start': (result: VADResult) => void;
  /** Emitted when a speech segment ends and silence begins. Contains VADResult and speech duration. */
  'speech_end': (result: VADResult, speechDurationMs: number) => void;
  /** Emitted for every frame that contains voice activity. Contains the VADResult. */
  'voice_activity': (result: VADResult) => void;
  /** Emitted for every frame that does not contain voice activity. Contains the VADResult. */
  'no_voice_activity': (result: VADResult) => void;
  /** Emitted when VAD thresholds are updated due to a new noise profile. */
  'thresholds_updated': (newSpeechThreshold: number, newSilenceThreshold: number, profile: NoiseProfile) => void;
}

/**
 * Configuration options for the AdaptiveVAD.
 */
export interface AdaptiveVADConfig {
  /**
   * Minimum duration in milliseconds that a sound segment must have to be considered speech.
   * Helps filter out very short, non-speech noises.
   * @default 150
   */
  minSpeechDurationMs?: number;
  /**
   * Maximum duration of silence in milliseconds within a speech segment before it's considered ended.
   * e.g., a pause between words.
   * @default 500
   */
  maxSilenceDurationMsInSpeech?: number;
  /**
   * Sensitivity adjustment factor, further fine-tunes thresholds from EnvironmentalCalibrator.
   * Values > 1.0 make VAD less sensitive (require louder input for speech).
   * Values < 1.0 make VAD more sensitive.
   * This is applied ON TOP of the sensitivity factor in EnvironmentalCalibrator.
   * @default 1.0
   */
  vadSensitivityFactor?: number;
  /**
   * Number of past frames to consider for smoothing energy calculations (if smoothing is applied).
   * @default 5
   */
  energySmoothingFrames?: number;
  /**
   * Ratio of speech_threshold / silence_threshold.
   * Helps in creating a hysteresis effect.
   * speech_threshold = silence_threshold * thresholdRatio
   * @default 1.5
   */
  thresholdRatio?: number;

  // Future considerations for more advanced VAD:
  // enableSpectralAnalysis?: boolean; // For ZCR, spectral flux, etc.
  // spectralConfig?: { zcrThreshold?: number; fluxThreshold?: number; };
}

// Declare emit and on methods more strongly for typed events
export declare interface AdaptiveVAD {
  on<U extends keyof VADEmitterEvents>(event: U, listener: VADEmitterEvents[U]): this;
  emit<U extends keyof VADEmitterEvents>(event: U, ...args: Parameters<VADEmitterEvents[U]>): boolean;
}

/**
 * AdaptiveVAD - Detects speech in audio frames, adapting to environmental noise.
 */
export class AdaptiveVAD extends EventEmitter {
  private config: Required<AdaptiveVADConfig>;
  private calibrator: EnvironmentalCalibrator;

  // Current dynamic thresholds
  private currentSpeechThreshold: number = 0;
  private currentSilenceThreshold: number = 0;

  // State variables
  private isCurrentlySpeaking: boolean = false;
  private speechSegmentStartTimeMs: number | null = null;
  private silenceSegmentStartTimeMs: number | null = null;

  private consecutiveSpeechFrames: number = 0;
  private consecutiveSilenceFrames: number = 0;

  // Frame duration in ms - assuming it's provided or calculable
  // This is important for minSpeechDurationMs and maxSilenceDurationMsInSpeech logic.
  // We'll need to know the duration of each frame passed to processFrame.
  private frameDurationMs: number; // This must be set, e.g., based on sampleRate and frameLength.

  private energyHistory: number[] = []; // For smoothing

  /**
   * Creates a new AdaptiveVAD instance.
   * @param {AdaptiveVADConfig} config - VAD configuration options.
   * @param {EnvironmentalCalibrator} calibrator - Instance of EnvironmentalCalibrator for noise profiles.
   * @param {number} frameDurationMs - Duration of each audio frame in milliseconds that will be processed.
   * (e.g., for 16000Hz and 320 samples/frame, duration is 20ms).
   */
  constructor(
    config: AdaptiveVADConfig = {},
    calibrator: EnvironmentalCalibrator,
    frameDurationMs: number
  ) {
    super();
    this.calibrator = calibrator;
    this.frameDurationMs = frameDurationMs;

    if (frameDurationMs <= 0) {
        throw new Error("frameDurationMs must be a positive number.");
    }

    this.config = {
      minSpeechDurationMs: config.minSpeechDurationMs || 120, // Adjusted default
      maxSilenceDurationMsInSpeech: config.maxSilenceDurationMsInSpeech || 400, // Adjusted default
      vadSensitivityFactor: config.vadSensitivityFactor || 1.0,
      energySmoothingFrames: config.energySmoothingFrames || 3, // Smoother default
      thresholdRatio: config.thresholdRatio || 1.5,
    };

    // Initialize thresholds from calibrator or set sane defaults if no profile yet
    const initialProfile = this.calibrator.getCurrentProfile();
    if (initialProfile) {
      this.updateThresholds(initialProfile);
    } else {
      // Fallback default thresholds if no profile is available at construction
      // These are arbitrary and will be quickly overwritten once a profile is available.
      this.currentSilenceThreshold = 0.01; // Arbitrary low silence threshold
      this.currentSpeechThreshold = this.currentSilenceThreshold * this.config.thresholdRatio;
      console.warn("AdaptiveVAD: Initialized with default thresholds. Waiting for noise profile.");
    }

    // Listen for profile updates from the calibrator
    this.calibrator.on('profile:updated', (profile) => {
      this.updateThresholds(profile);
    });
    this.calibrator.on('calibration:complete', (profile) => {
        this.updateThresholds(profile); // Ensure thresholds are set after initial calibration
    });
  }

  /**
   * Updates the VAD's internal speech and silence thresholds based on a new noise profile.
   * @param {NoiseProfile} profile - The noise profile from the EnvironmentalCalibrator.
   */
  private updateThresholds(profile: NoiseProfile): void {
    // Use suggested thresholds from profile and apply VAD-specific sensitivity
    // The profile's suggestedSilenceThreshold is a good starting point.
    const baseSilenceThreshold = profile.suggestedSilenceThreshold;

    // Apply VAD sensitivity factor
    this.currentSilenceThreshold = baseSilenceThreshold * this.config.vadSensitivityFactor;
    this.currentSpeechThreshold = Math.max(
        profile.suggestedSpeechThreshold * this.config.vadSensitivityFactor,
        this.currentSilenceThreshold * this.config.thresholdRatio // Ensure speech threshold is notably higher
    );

    // Sanity checks: thresholds should not be negative or excessively low
    this.currentSilenceThreshold = Math.max(this.currentSilenceThreshold, 0.0001);
    this.currentSpeechThreshold = Math.max(this.currentSpeechThreshold, this.currentSilenceThreshold + 0.0001);


    this.emit('thresholds_updated', this.currentSpeechThreshold, this.currentSilenceThreshold, profile);
    // console.debug(`AdaptiveVAD: Thresholds updated. Speech: ${this.currentSpeechThreshold.toFixed(4)}, Silence: ${this.currentSilenceThreshold.toFixed(4)} based on env: ${profile.environmentType}`);
  }

  /**
   * Processes an incoming audio frame to detect voice activity.
   * @param {Float32Array} audioFrame - A chunk of raw audio data (PCM).
   * @returns {VADResult} The result of VAD processing for this frame.
   */
  public processFrame(audioFrame: Float32Array): VADResult {
    if (!audioFrame || audioFrame.length === 0) {
      console.warn('AdaptiveVAD: Received empty audio frame.');
      const emptyResult: VADResult = {
          isSpeech: false,
          frameEnergy: 0,
          currentSpeechThreshold: this.currentSpeechThreshold,
          currentSilenceThreshold: this.currentSilenceThreshold,
      };
      this.handleNoVoiceActivity(emptyResult); // Process as silence
      return emptyResult;
    }

    const frameEnergy = this.calculateRMS(audioFrame);
    const smoothedEnergy = this.getSmoothedEnergy(frameEnergy);

    const vadResult: VADResult = {
      isSpeech: false, // Will be determined below
      frameEnergy: smoothedEnergy,
      currentSpeechThreshold: this.currentSpeechThreshold,
      currentSilenceThreshold: this.currentSilenceThreshold,
    };

    // --- Core VAD Logic with Hysteresis ---
    if (this.isCurrentlySpeaking) {
      // If already speaking, look for energy to drop below SILENCE threshold to stop
      if (smoothedEnergy < this.currentSilenceThreshold) {
        vadResult.isSpeech = false; // Tentatively, might still be in allowed pause
        this.handleNoVoiceActivity(vadResult);
      } else {
        vadResult.isSpeech = true; // Speech continues
        this.handleVoiceActivity(vadResult);
      }
    } else {
      // If not speaking, look for energy to rise above SPEECH threshold to start
      if (smoothedEnergy > this.currentSpeechThreshold) {
        vadResult.isSpeech = true; // Tentatively, might be a short blip
        this.handleVoiceActivity(vadResult);
      } else {
        vadResult.isSpeech = false; // Silence continues
        this.handleNoVoiceActivity(vadResult);
      }
    }
    return vadResult;
  }

  private handleVoiceActivity(result: VADResult): void {
    this.consecutiveSpeechFrames++;
    this.consecutiveSilenceFrames = 0; // Reset silence counter
    this.silenceSegmentStartTimeMs = null; // Reset silence start time as speech is active

    if (!this.isCurrentlySpeaking) {
      // Potential start of speech, check if it meets min duration
      const potentialSpeechDurationMs = this.consecutiveSpeechFrames * this.frameDurationMs;
      if (potentialSpeechDurationMs >= this.config.minSpeechDurationMs) {
        this.isCurrentlySpeaking = true;
        this.speechSegmentStartTimeMs = Date.now() - potentialSpeechDurationMs; // Backdate start time
        this.emit('speech_start', result);
        this.calibrator.onVoiceActivityDetected(); // Inform calibrator
      }
    }

    if (this.isCurrentlySpeaking) { // If definitely speaking (or just confirmed)
      this.emit('voice_activity', result);
    }
  }

  private handleNoVoiceActivity(result: VADResult): void {
    this.consecutiveSilenceFrames++;
    // Don't reset consecutiveSpeechFrames immediately, allow for maxSilenceDurationMsInSpeech for pauses

    if (this.isCurrentlySpeaking) {
      // Was speaking, now detected silence. Could be a pause or end of speech.
      if (!this.silenceSegmentStartTimeMs) {
        this.silenceSegmentStartTimeMs = Date.now();
      }

      const currentPauseDurationMs = Date.now() - this.silenceSegmentStartTimeMs;

      if (currentPauseDurationMs >= this.config.maxSilenceDurationMsInSpeech) {
        // Pause is too long, speech segment has ended.
        const totalSpeechDurationMs = (this.speechSegmentStartTimeMs)
            ? (this.silenceSegmentStartTimeMs - this.speechSegmentStartTimeMs) // Duration until pause started
            : this.consecutiveSpeechFrames * this.frameDurationMs; // Fallback if start time somehow not set

        // Ensure the speech itself was long enough before declaring it ended
        if (totalSpeechDurationMs >= this.config.minSpeechDurationMs) {
            this.emit('speech_end', result, totalSpeechDurationMs);
        }
        // Else, it was too short to be a valid speech segment, effectively becomes silence.

        this.isCurrentlySpeaking = false;
        this.speechSegmentStartTimeMs = null;
        this.consecutiveSpeechFrames = 0; // Reset speech counter fully now
        // consecutiveSilenceFrames continues counting for the new silence segment
      }
    }
    // If !this.isCurrentlySpeaking, silence just continues.
    this.emit('no_voice_activity', result);
  }

  /**
   * Calculates the Root Mean Square (RMS) energy of an audio frame.
   * @param {Float32Array} audioFrame - The audio frame.
   * @returns {number} The RMS energy of the frame.
   */
  private calculateRMS(audioFrame: Float32Array): number {
    let sumOfSquares = 0;
    for (let i = 0; i < audioFrame.length; i++) {
      sumOfSquares += audioFrame[i] * audioFrame[i];
    }
    return Math.sqrt(sumOfSquares / audioFrame.length);
  }

  /**
   * Provides a smoothed energy value based on recent frame energies.
   * @param {number} currentFrameEnergy - The RMS energy of the current frame.
   * @returns {number} The smoothed energy value.
   */
  private getSmoothedEnergy(currentFrameEnergy: number): number {
    this.energyHistory.push(currentFrameEnergy);
    if (this.energyHistory.length > this.config.energySmoothingFrames) {
      this.energyHistory.shift();
    }
    if (this.energyHistory.length === 0) return 0;

    // Simple moving average
    const sum = this.energyHistory.reduce((s, val) => s + val, 0);
    return sum / this.energyHistory.length;
  }

  /**
   * Resets the VAD's internal state.
   * Useful when starting a new audio stream or after a manual interruption.
   */
  public resetState(): void {
    this.isCurrentlySpeaking = false;
    this.speechSegmentStartTimeMs = null;
    this.silenceSegmentStartTimeMs = null;
    this.consecutiveSpeechFrames = 0;
    this.consecutiveSilenceFrames = 0;
    this.energyHistory = [];
    console.log('AdaptiveVAD: State reset.');
  }

  /**
   * Gets the current VAD state.
   */
  public getCurrentState(): {
    isSpeaking: boolean;
    speechThreshold: number;
    silenceThreshold: number;
    consecutiveSpeechFrames: number;
    consecutiveSilenceFrames: number;
  } {
    return {
        isSpeaking: this.isCurrentlySpeaking,
        speechThreshold: this.currentSpeechThreshold,
        silenceThreshold: this.currentSilenceThreshold,
        consecutiveSpeechFrames: this.consecutiveSpeechFrames,
        consecutiveSilenceFrames: this.consecutiveSilenceFrames,
    };
  }

  /**
   * Exposes the current VAD configuration in a read-only manner.
   */
  public getConfig(): Readonly<Required<AdaptiveVADConfig>> {
    return { ...this.config };
  }
}
