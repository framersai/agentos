import { EventEmitter } from 'events';
/**
 * @fileoverview Environmental noise calibration and adaptation system for Web Browsers.
 * This module uses Web Audio APIs to understand the acoustic properties of the
 * environment by analyzing an input MediaStream for initial calibration, and then
 * processing raw audio frames (Float32Array) for continuous adaptation.
 * @module hearing/EnvironmentalCalibrator
 */
/**
 * Represents the acoustic profile of the environment.
 * This profile is used by other audio components (like VAD) to adjust their sensitivity.
 */
export interface NoiseProfile {
    /** Root Mean Square of the baseline ambient noise, calculated using a percentile. */
    baselineRMS: number;
    /** Peak Root Mean Square detected during an observation window. */
    peakRMS: number;
    /** Standard deviation of RMS values, indicating noise floor stability. */
    noiseStdDev: number;
    /**
     * Optional frequency spectrum analysis (e.g., 32 bands).
     * Populated if `enableFrequencyAnalysis` is true.
     */
    frequencyProfile?: Float32Array;
    /** Classified type of the acoustic environment. */
    environmentType: 'quiet' | 'normal' | 'noisy' | 'very_noisy';
    /** Confidence in the profile (0-1), based on data quantity and stability. */
    confidenceScore: number;
    /** Timestamp (Unix epoch ms) of when this profile was last calculated. */
    timestamp: number;
    /** Suggested speech detection threshold (RMS value) based on this profile. */
    suggestedSpeechThreshold: number;
    /** Suggested silence detection threshold (RMS value) based on this profile. */
    suggestedSilenceThreshold: number;
    /** Number of audio frames/buffers analyzed to generate or update this profile. */
    framesAnalyzedCount: number;
}
/**
 * Configuration for environmental calibration using Web Audio APIs.
 */
export interface CalibrationConfig {
    /**
     * Duration in milliseconds for the initial calibration phase via MediaStream.
     * @default 3000
     */
    initialCalibrationMs?: number;
    /**
     * Buffer size for the ScriptProcessorNode used during initial calibration.
     * Affects how often audio data is analyzed during calibration.
     * @default 4096
     */
    calibrationBufferSize?: number;
    /**
     * Minimum number of RMS samples (from processed frames) required for a meaningful profile update
     * during continuous adaptation (when `processAudioFrame` is called).
     * @default 50
     */
    minRmsSamplesForContinuousUpdate?: number;
    /**
     * Initial interval in milliseconds for continuous adaptation checks if no voice activity.
     * This applies when `processAudioFrame` is used for continuous updates.
     * @default 1000
     */
    initialUpdateIntervalMs?: number;
    /**
     * Multiplier for the exponential backoff strategy during continuous adaptation.
     * @default 1.5
     */
    backoffMultiplier?: number;
    /**
     * Maximum interval in milliseconds for continuous adaptation checks.
     * @default 30000
     */
    maxBackoffIntervalMs?: number;
    /**
     * Minimum interval in milliseconds for continuous adaptation checks after activity or change.
     * @default 500
     */
    minBackoffIntervalMs?: number;
    /**
     * Number of recent RMS values (from processed frames) to store in a buffer for continuous adaptation.
     * @default 50
     */
    rmsHistoryBufferSize?: number;
    /**
     * Sensitivity adjustment factor for calculating speech/silence thresholds.
     * @default 1.0
     */
    thresholdSensitivityFactor?: number;
    /**
     * Enable frequency analysis using AnalyserNode during initial calibration.
     * @default true
     */
    enableFrequencyAnalysis?: boolean;
    /**
     * FFT size for the AnalyserNode. Must be a power of 2.
     * `frequencyBinCount` will be `fftSize / 2`.
     * @default 256 (yields 128 frequency bins)
     */
    fftSize?: number;
    /**
     * Sample rate of the audio. The calibrator will try to use this for its internal AudioContext.
     * If the input MediaStream has a different rate, resampling might occur or the stream's rate is used.
     * @default 16000
     */
    sampleRate?: number;
}
/**
 * Events emitted by the EnvironmentalCalibrator.
 */
export interface CalibrationEvents {
    'profile:updated': (profile: NoiseProfile) => void;
    'environment:changed': (newEnvironment: NoiseProfile['environmentType'], oldEnvironment: NoiseProfile['environmentType'], profile: NoiseProfile) => void;
    'calibration:progress': (progress: number, currentRms: number) => void;
    'calibration:complete': (profile: NoiseProfile) => void;
    'calibration:started': () => void;
    'calibration:error': (error: Error) => void;
    'anomaly:detected': (type: string, details: any, profile: NoiseProfile | null) => void;
}
export declare interface EnvironmentalCalibrator {
    on<U extends keyof CalibrationEvents>(event: U, listener: CalibrationEvents[U]): this;
    emit<U extends keyof CalibrationEvents>(event: U, ...args: Parameters<CalibrationEvents[U]>): boolean;
}
/**
 * EnvironmentalCalibrator (Web Version) - Adapts to acoustic environment in real-time
 * using Web Audio APIs for initial calibration and processing raw frames for continuous updates.
 */
export declare class EnvironmentalCalibrator extends EventEmitter {
    private config;
    private currentProfile;
    private profileHistory;
    private rmsValuesForContinuousAdapt;
    private currentBackoffIntervalMs;
    private lastProfileUpdateTimeMs;
    private lastVoiceActivityTimeMs;
    private isDuringInitialCalibration;
    private anomalyDetector;
    private calibrationAudioContext;
    private calibrationSourceNode;
    private calibrationProcessorNode;
    private calibrationAnalyserNode;
    /**
     * Creates a new EnvironmentalCalibrator instance.
     * @param {CalibrationConfig} config - Configuration options.
     */
    constructor(config?: CalibrationConfig);
    /**
     * Performs initial environment calibration using a MediaStream.
     * Sets up a temporary Web Audio pipeline to analyze the stream.
     * @param {MediaStream} audioStream - The live audio input stream for calibration.
     * @returns {Promise<NoiseProfile>} A promise that resolves with the initial noise profile,
     * or rejects if calibration fails.
     */
    calibrate(audioStream: MediaStream): Promise<NoiseProfile>;
    /** Cleans up Web Audio nodes used specifically for initial calibration. */
    private cleanupCalibrationAudioNodes;
    /**
     * Analyzes collected RMS and frequency samples to generate a NoiseProfile.
     * @param rmsSamples - Array of RMS values from calibration.
     * @param frequencySamples - Array of frequency data arrays from calibration.
     * @returns {NoiseProfile} The calculated noise profile.
     */
    private analyzeCalibrationSamples;
    /**
     * Processes a single audio frame for continuous adaptation after initial calibration.
     * @param {Float32Array} audioFrame - A chunk of raw audio data (PCM).
     */
    continuousAdaptation(audioFrame: Float32Array): void;
    /**
     * Helper to update profile based on current RMS history (primarily for continuous adaptation).
     */
    private updateProfileFromRmsHistory;
    /** Classifies the environment based on noise characteristics. */
    private classifyEnvironment;
    /** Calculates adaptive speech and silence thresholds. */
    private calculateAdaptiveThresholds;
    private detectAnomalies;
    /** Records voice activity detection to reset backoff. */
    onVoiceActivityDetected(): void;
    getCurrentProfile(): NoiseProfile | null;
    private addToRmsHistory;
    private calculateRMS;
    private calculatePercentile;
    private calculateStdDev;
    private calculateConfidence;
}
//# sourceMappingURL=EnvironmentalCalibrator.d.ts.map