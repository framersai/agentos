import { EventEmitter } from 'events';
import { EnvironmentalCalibrator, NoiseProfile } from './EnvironmentalCalibrator';
/**
 * @fileoverview Adaptive Voice Activity Detection (VAD) system for Node.js.
 * This module processes raw audio frames and uses an environmental noise profile
 * to dynamically adjust its sensitivity for detecting speech.
 * It does NOT rely on browser Web Audio APIs.
 * @module hearing/AdaptiveVAD
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
    confidence?: number;
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
}
/**
 * AdaptiveVAD - Detects speech in audio frames, adapting to environmental noise.
 */
export declare class AdaptiveVAD extends EventEmitter {
    private config;
    private calibrator;
    private currentSpeechThreshold;
    private currentSilenceThreshold;
    private isCurrentlySpeaking;
    private speechSegmentStartTimeMs;
    private silenceSegmentStartTimeMs;
    private consecutiveSpeechFrames;
    private consecutiveSilenceFrames;
    private frameDurationMs;
    private energyHistory;
    on<U extends keyof VADEmitterEvents>(event: U, listener: VADEmitterEvents[U]): this;
    emit<U extends keyof VADEmitterEvents>(event: U, ...args: Parameters<VADEmitterEvents[U]>): boolean;
    /**
     * Creates a new AdaptiveVAD instance.
     * @param {AdaptiveVADConfig} config - VAD configuration options.
     * @param {EnvironmentalCalibrator} calibrator - Instance of EnvironmentalCalibrator for noise profiles.
     * @param {number} frameDurationMs - Duration of each audio frame in milliseconds that will be processed.
     * (e.g., for 16000Hz and 320 samples/frame, duration is 20ms).
     */
    constructor(config: AdaptiveVADConfig | undefined, calibrator: EnvironmentalCalibrator, frameDurationMs: number);
    /**
     * Updates the VAD's internal speech and silence thresholds based on a new noise profile.
     * @param {NoiseProfile} profile - The noise profile from the EnvironmentalCalibrator.
     */
    private updateThresholds;
    /**
     * Processes an incoming audio frame to detect voice activity.
     * @param {Float32Array} audioFrame - A chunk of raw audio data (PCM).
     * @returns {VADResult} The result of VAD processing for this frame.
     */
    processFrame(audioFrame: Float32Array): VADResult;
    private handleVoiceActivity;
    private handleNoVoiceActivity;
    /**
     * Calculates the Root Mean Square (RMS) energy of an audio frame.
     * @param {Float32Array} audioFrame - The audio frame.
     * @returns {number} The RMS energy of the frame.
     */
    private calculateRMS;
    /**
     * Provides a smoothed energy value based on recent frame energies.
     * @param {number} currentFrameEnergy - The RMS energy of the current frame.
     * @returns {number} The smoothed energy value.
     */
    private getSmoothedEnergy;
    /**
     * Resets the VAD's internal state.
     * Useful when starting a new audio stream or after a manual interruption.
     */
    resetState(): void;
    /**
     * Gets the current VAD state.
     */
    getCurrentState(): {
        isSpeaking: boolean;
        speechThreshold: number;
        silenceThreshold: number;
        consecutiveSpeechFrames: number;
        consecutiveSilenceFrames: number;
    };
    /**
     * Exposes the current VAD configuration in a read-only manner.
     */
    getConfig(): Readonly<Required<AdaptiveVADConfig>>;
}
//# sourceMappingURL=AdaptiveVAD.d.ts.map