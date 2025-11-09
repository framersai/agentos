// backend/agentos/core/audio/EnvironmentalCalibrator.ts

import { EventEmitter } from 'events';

/**
 * @fileoverview Environmental noise calibration and adaptation system for Web Browsers.
 * This module uses Web Audio APIs to understand the acoustic properties of the
 * environment by analyzing an input MediaStream for initial calibration, and then
 * processing raw audio frames (Float32Array) for continuous adaptation.
 * @module agentos/core/audio/EnvironmentalCalibrator
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
  'calibration:progress': (progress: number, currentRms: number) => void; // Progress 0-1
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
export class EnvironmentalCalibrator extends EventEmitter {
  private config: Required<CalibrationConfig>;
  private currentProfile: NoiseProfile | null = null;
  private profileHistory: NoiseProfile[] = [];
  private rmsValuesForContinuousAdapt: number[] = []; // Stores RMS of recent frames for continuous adaptation

  private currentBackoffIntervalMs: number;
  private lastProfileUpdateTimeMs: number = Date.now();
  private lastVoiceActivityTimeMs: number = Date.now(); // For resetting backoff
  private isDuringInitialCalibration: boolean = false;
  private anomalyDetector: AnomalyDetector;

  // Web Audio API related properties for initial calibration
  private calibrationAudioContext: AudioContext | null = null;
  private calibrationSourceNode: MediaStreamAudioSourceNode | null = null;
  private calibrationProcessorNode: ScriptProcessorNode | null = null;
  private calibrationAnalyserNode: AnalyserNode | null = null;

  /**
   * Creates a new EnvironmentalCalibrator instance.
   * @param {CalibrationConfig} config - Configuration options.
   */
  constructor(config: CalibrationConfig = {}) {
    super();

    this.config = {
      initialCalibrationMs: config.initialCalibrationMs || 3000,
      calibrationBufferSize: config.calibrationBufferSize || 4096,
      minRmsSamplesForContinuousUpdate: config.minRmsSamplesForContinuousUpdate || 50,
      initialUpdateIntervalMs: config.initialUpdateIntervalMs || 1000,
      backoffMultiplier: config.backoffMultiplier || 1.5,
      maxBackoffIntervalMs: config.maxBackoffIntervalMs || 30000,
      minBackoffIntervalMs: config.minBackoffIntervalMs || 500,
      rmsHistoryBufferSize: config.rmsHistoryBufferSize || 50,
      thresholdSensitivityFactor: config.thresholdSensitivityFactor || 1.0,
      enableFrequencyAnalysis: config.enableFrequencyAnalysis ?? true,
      fftSize: config.fftSize || 256,
      sampleRate: config.sampleRate || 16000,
    };

    this.currentBackoffIntervalMs = this.config.initialUpdateIntervalMs;
    this.anomalyDetector = new AnomalyDetector();
  }

  /**
   * Performs initial environment calibration using a MediaStream.
   * Sets up a temporary Web Audio pipeline to analyze the stream.
   * @param {MediaStream} audioStream - The live audio input stream for calibration.
   * @returns {Promise<NoiseProfile>} A promise that resolves with the initial noise profile,
   * or rejects if calibration fails.
   */
  public async calibrate(audioStream: MediaStream): Promise<NoiseProfile> {
    if (this.isDuringInitialCalibration) {
      console.warn("Calibration is already in progress.");
      return Promise.reject(new Error("Calibration already in progress."));
    }
    console.log(`🎤 Starting environmental calibration for ${this.config.initialCalibrationMs}ms (Web Audio)...`);
    this.isDuringInitialCalibration = true;
    this.emit('calibration:started');

    const collectedRmsSamples: number[] = [];
    const collectedFrequencySamples: Float32Array[] = [];
    let processedDuration = 0;

    return new Promise<NoiseProfile>((resolve, reject) => {
      try {
        this.calibrationAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: this.config.sampleRate, // Attempt to use configured sample rate
        });

        // Check actual sample rate
        const actualSampleRate = this.calibrationAudioContext.sampleRate;
        if (Math.abs(actualSampleRate - this.config.sampleRate) > 100) {
            console.warn(`Calibrator: AudioContext using sample rate ${actualSampleRate}Hz, configured was ${this.config.sampleRate}Hz.`);
        }

        this.calibrationSourceNode = this.calibrationAudioContext.createMediaStreamSource(audioStream);
        this.calibrationProcessorNode = this.calibrationAudioContext.createScriptProcessor(
          this.config.calibrationBufferSize,
          1, // input channels
          1  // output channels
        );

        if (this.config.enableFrequencyAnalysis) {
          this.calibrationAnalyserNode = this.calibrationAudioContext.createAnalyser();
          this.calibrationAnalyserNode.fftSize = this.config.fftSize;
          this.calibrationSourceNode.connect(this.calibrationAnalyserNode);
          this.calibrationAnalyserNode.connect(this.calibrationProcessorNode);
        } else {
          this.calibrationSourceNode.connect(this.calibrationProcessorNode);
        }

        this.calibrationProcessorNode.connect(this.calibrationAudioContext.destination); // Keep graph alive

        this.calibrationProcessorNode.onaudioprocess = (event: AudioProcessingEvent) => {
          if (!this.isDuringInitialCalibration) return; // Stop processing if calibration ended prematurely

          const inputData = event.inputBuffer.getChannelData(0);
          const frameDuration = event.inputBuffer.duration * 1000; // Duration of this chunk in ms
          processedDuration += frameDuration;

          const rms = this.calculateRMS(inputData);
          collectedRmsSamples.push(rms);

          if (this.config.enableFrequencyAnalysis && this.calibrationAnalyserNode) {
            const freqData = new Float32Array(this.calibrationAnalyserNode.frequencyBinCount);
            this.calibrationAnalyserNode.getFloatFrequencyData(freqData); // Get dB values
            collectedFrequencySamples.push(freqData);
          }
          
          const progress = Math.min(processedDuration / this.config.initialCalibrationMs, 1);
          this.emit('calibration:progress', progress, rms);

          if (processedDuration >= this.config.initialCalibrationMs) {
            this.isDuringInitialCalibration = false; // Mark as finished
            // Finalize and clean up immediately after flag is set
            try {
                const profile = this.analyzeCalibrationSamples(collectedRmsSamples, collectedFrequencySamples);
                this.currentProfile = profile;
                this.profileHistory.push(profile);
                this.lastProfileUpdateTimeMs = Date.now();
                this.rmsValuesForContinuousAdapt = collectedRmsSamples.slice(-this.config.rmsHistoryBufferSize); // Pre-fill buffer

                this.emit('calibration:complete', profile);
                console.log('✅ Calibration complete (Web Audio):', {
                    environment: profile.environmentType,
                    baselineRMS: profile.baselineRMS.toFixed(4),
                });
                resolve(profile);
            } catch (analysisError) {
                console.error("Error analyzing calibration data:", analysisError);
                this.emit('calibration:error', analysisError as Error);
                reject(analysisError);
            } finally {
                this.cleanupCalibrationAudioNodes();
            }
          }
        };
      } catch (error) {
        console.error('❌ Error setting up Web Audio for calibration:', error);
        this.isDuringInitialCalibration = false;
        this.emit('calibration:error', error as Error);
        this.cleanupCalibrationAudioNodes(); // Ensure cleanup on setup error
        reject(error);
      }
    });
  }

  /** Cleans up Web Audio nodes used specifically for initial calibration. */
  private cleanupCalibrationAudioNodes(): void {
    this.calibrationProcessorNode?.disconnect();
    this.calibrationAnalyserNode?.disconnect();
    this.calibrationSourceNode?.disconnect();

    // It's good practice to close the AudioContext if it was created solely for calibration
    // and is not shared. If shared, this responsibility lies elsewhere.
    if (this.calibrationAudioContext && this.calibrationAudioContext.state !== 'closed') {
      this.calibrationAudioContext.close().catch(e => console.warn("Error closing calibration AudioContext:", e));
    }
    this.calibrationAudioContext = null;
    this.calibrationProcessorNode = null;
    this.calibrationAnalyserNode = null;
    this.calibrationSourceNode = null;
    // console.debug("Calibration audio nodes cleaned up.");
  }

  /**
   * Analyzes collected RMS and frequency samples to generate a NoiseProfile.
   * @param rmsSamples - Array of RMS values from calibration.
   * @param frequencySamples - Array of frequency data arrays from calibration.
   * @returns {NoiseProfile} The calculated noise profile.
   */
  private analyzeCalibrationSamples(
    rmsSamples: number[],
    frequencySamples: Float32Array[]
  ): NoiseProfile {
    if (rmsSamples.length === 0) {
      throw new Error("Cannot analyze empty RMS samples for calibration.");
    }

    const sortedRms = [...rmsSamples].sort((a, b) => a - b);
    const baselineRMS = this.calculatePercentile(sortedRms, 0.25); // Robust baseline
    const peakRMS = this.calculatePercentile(sortedRms, 0.95);
    const noiseStdDev = this.calculateStdDev(rmsSamples, baselineRMS);

    let avgFrequencyProfile: Float32Array | undefined = undefined;
    if (this.config.enableFrequencyAnalysis && frequencySamples.length > 0 && this.calibrationAnalyserNode) {
        const numBins = this.calibrationAnalyserNode.frequencyBinCount;
        avgFrequencyProfile = new Float32Array(numBins);
        for (let i = 0; i < numBins; i++) {
            let sumForBin = 0;
            for (const freqSample of frequencySamples) {
                sumForBin += freqSample[i]; // These are typically dB values
            }
            avgFrequencyProfile[i] = sumForBin / frequencySamples.length;
        }
    }

    const environmentType = this.classifyEnvironment(baselineRMS, peakRMS, noiseStdDev);
    const { speechThreshold, silenceThreshold } = this.calculateAdaptiveThresholds(
      baselineRMS, peakRMS, noiseStdDev, environmentType
    );

    return {
      baselineRMS,
      peakRMS,
      noiseStdDev,
      frequencyProfile: avgFrequencyProfile,
      environmentType,
      confidenceScore: this.calculateConfidence(rmsSamples, noiseStdDev),
      timestamp: Date.now(),
      suggestedSpeechThreshold: speechThreshold,
      suggestedSilenceThreshold: silenceThreshold,
      framesAnalyzedCount: rmsSamples.length,
    };
  }

  /**
   * Processes a single audio frame for continuous adaptation after initial calibration.
   * @param {Float32Array} audioFrame - A chunk of raw audio data (PCM).
   */
  public continuousAdaptation(audioFrame: Float32Array): void {
    if (this.isDuringInitialCalibration || !this.currentProfile) {
      // console.warn("Calibrator: Cannot perform continuous adaptation during initial calibration or without a profile.");
      return;
    }
    if (!audioFrame || audioFrame.length === 0) return;

    const rms = this.calculateRMS(audioFrame);
    this.addToRmsHistory(rms);

    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastProfileUpdateTimeMs;

    if (timeSinceLastUpdate >= this.currentBackoffIntervalMs && this.rmsValuesForContinuousAdapt.length >= this.config.minRmsSamplesForContinuousUpdate) {
      const avgRMSInHistory = this.rmsValuesForContinuousAdapt.reduce((s, v) => s + v, 0) / this.rmsValuesForContinuousAdapt.length;
      const deviationFromProfile = Math.abs(avgRMSInHistory - this.currentProfile.baselineRMS);
      // More sensitive change detection for continuous adaptation: 30% change in baseline or if std dev changes a lot
      const significantChangeThreshold = this.currentProfile.baselineRMS * 0.3;
      const currentStdDev = this.calculateStdDev(this.rmsValuesForContinuousAdapt);
      const stdDevChange = Math.abs(currentStdDev - this.currentProfile.noiseStdDev) / (this.currentProfile.noiseStdDev || 0.001) ;


      if (deviationFromProfile > significantChangeThreshold || stdDevChange > 0.5) { // Or 50% change in std dev
        // Re-calculate profile based on current rmsValuesForContinuousAdapt
        // For frequency profile, we'd ideally need a way to get it from the current frame if enabled,
        // or decide not to update it during continuous adaptation without a live AnalyserNode.
        // For simplicity, continuous adaptation here focuses on RMS-based metrics.
        const updatedProfile = this.updateProfileFromRmsHistory(this.rmsValuesForContinuousAdapt, this.currentProfile);
        const oldEnvironment = this.currentProfile.environmentType;
        this.currentProfile = updatedProfile;
        this.profileHistory.push(updatedProfile);

        this.emit('profile:updated', updatedProfile);
        if (oldEnvironment !== updatedProfile.environmentType) {
          this.emit('environment:changed', updatedProfile.environmentType, oldEnvironment, updatedProfile);
          console.log(`🔄 Environment changed (continuous): ${oldEnvironment} → ${updatedProfile.environmentType}`);
        }
        this.currentBackoffIntervalMs = this.config.minBackoffIntervalMs; // Reset backoff
      } else {
        this.currentBackoffIntervalMs = Math.min(
          this.currentBackoffIntervalMs * this.config.backoffMultiplier,
          this.config.maxBackoffIntervalMs
        );
      }
      this.lastProfileUpdateTimeMs = now;
    }
    this.detectAnomalies(rms);
  }

  /**
   * Helper to update profile based on current RMS history (primarily for continuous adaptation).
   */
  private updateProfileFromRmsHistory(rmsHistory: number[], baseProfile: NoiseProfile): NoiseProfile {
      const sortedRms = [...rmsHistory].sort((a,b) => a - b);
      const baselineRMS = this.calculatePercentile(sortedRms, 0.25);
      const peakRMS = this.calculatePercentile(sortedRms, 0.95);
      const noiseStdDev = this.calculateStdDev(rmsHistory, baselineRMS);

      const environmentType = this.classifyEnvironment(baselineRMS, peakRMS, noiseStdDev);
      const { speechThreshold, silenceThreshold } = this.calculateAdaptiveThresholds(
          baselineRMS, peakRMS, noiseStdDev, environmentType
      );
      
      // Note: Frequency profile is not updated here unless a live AnalyserNode frame is passed.
      // It retains the frequency profile from the initial calibration or last full update.
      return {
          ...baseProfile, // Retain other fields like original frequencyProfile
          baselineRMS,
          peakRMS,
          noiseStdDev,
          environmentType,
          suggestedSpeechThreshold: speechThreshold,
          suggestedSilenceThreshold: silenceThreshold,
          confidenceScore: this.calculateConfidence(rmsHistory, noiseStdDev),
          timestamp: Date.now(),
          framesAnalyzedCount: rmsHistory.length,
      };
  }


  /** Classifies the environment based on noise characteristics. */
  private classifyEnvironment(
    baselineRMS: number, peakRMS: number, stdDev: number
  ): NoiseProfile['environmentType'] {
    const dynamicRange = peakRMS - baselineRMS;
    const variability = baselineRMS > 0.0001 ? stdDev / baselineRMS : stdDev / 0.0001;

    if (baselineRMS < 0.008 && dynamicRange < 0.02 && variability < 0.5) return 'quiet';
    if (baselineRMS < 0.025 && dynamicRange < 0.05 && variability < 0.7) return 'normal';
    if (baselineRMS < 0.05 || dynamicRange < 0.1 || variability > 0.6) return 'noisy';
    return 'very_noisy';
  }

  /** Calculates adaptive speech and silence thresholds. */
  private calculateAdaptiveThresholds(
    baselineRMS: number, peakRMS: number, stdDev: number, environment: NoiseProfile['environmentType']
  ): { speechThreshold: number; silenceThreshold: number } {
    const multipliers = {
      quiet:      { speechFactor: 2.8, silenceFactor: 1.8, stdDevFactor: 1.2 },
      normal:     { speechFactor: 3.2, silenceFactor: 2.0, stdDevFactor: 1.5 },
      noisy:      { speechFactor: 3.8, silenceFactor: 2.5, stdDevFactor: 1.8 },
      very_noisy: { speechFactor: 4.5, silenceFactor: 3.0, stdDevFactor: 2.2 }
    };
    const envConfig = multipliers[environment];
    const adaptiveMargin = stdDev * envConfig.stdDevFactor * this.config.thresholdSensitivityFactor;

    const speechThreshold = baselineRMS * envConfig.speechFactor * this.config.thresholdSensitivityFactor + adaptiveMargin;
    const silenceThreshold = baselineRMS * envConfig.silenceFactor * this.config.thresholdSensitivityFactor + adaptiveMargin / 2;

    const minSpeechOverSilence = Math.max(baselineRMS * 1.1, 0.001);
    const finalSilenceThreshold = Math.max(silenceThreshold, baselineRMS + 0.0005);
    const finalSpeechThreshold = Math.max(speechThreshold, finalSilenceThreshold + minSpeechOverSilence);

    return { speechThreshold: finalSpeechThreshold, silenceThreshold: finalSilenceThreshold };
  }

  private detectAnomalies(currentFrameRms: number): void {
    const anomalies = this.anomalyDetector.detect(currentFrameRms, this.currentProfile, this.rmsValuesForContinuousAdapt);
    anomalies.forEach(anomaly => {
      this.emit('anomaly:detected', anomaly.type, anomaly.details, this.currentProfile);
    });
  }

  /** Records voice activity detection to reset backoff. */
  public onVoiceActivityDetected(): void {
    this.lastVoiceActivityTimeMs = Date.now();
    this.currentBackoffIntervalMs = this.config.minBackoffIntervalMs;
  }

  public getCurrentProfile(): NoiseProfile | null {
    return this.currentProfile ? { ...this.currentProfile } : null; // Return a copy
  }

  private addToRmsHistory(rms: number): void {
    this.rmsValuesForContinuousAdapt.push(rms);
    if (this.rmsValuesForContinuousAdapt.length > this.config.rmsHistoryBufferSize) {
      this.rmsValuesForContinuousAdapt.shift();
    }
  }

  private calculateRMS(audioFrame: Float32Array): number {
    let sumOfSquares = 0;
    for (let i = 0; i < audioFrame.length; i++) sumOfSquares += audioFrame[i] * audioFrame[i];
    return Math.sqrt(sumOfSquares / audioFrame.length);
  }

  private calculatePercentile(sortedData: number[], percentile: number): number {
    if (sortedData.length === 0) return 0;
    const index = Math.floor(sortedData.length * percentile);
    return sortedData[Math.min(index, sortedData.length - 1)];
  }

  private calculateStdDev(data: number[], mean?: number): number {
    if (data.length < 2) return 0;
    const m = mean !== undefined ? mean : data.reduce((s, v) => s + v, 0) / data.length;
    const variance = data.reduce((acc, val) => acc + (val - m) ** 2, 0) / data.length;
    return Math.sqrt(variance);
  }

  private calculateConfidence(rmsValues: number[], stdDev: number): number {
    if (rmsValues.length === 0) return 0;
    const dataQuantityFactor = Math.min(rmsValues.length / this.config.rmsHistoryBufferSize, 1.0); // For continuous, or initialCalibrationFrames for initial
    const meanRms = rmsValues.reduce((s, v) => s + v, 0) / rmsValues.length;
    let stabilityFactor = 0.5;
    if (meanRms > 0.0001) stabilityFactor = Math.max(0, 1 - (stdDev / meanRms));
    if (meanRms < 0.01 && stdDev < 0.005) stabilityFactor = Math.max(stabilityFactor, 0.75);
    return (dataQuantityFactor * 0.6 + stabilityFactor * 0.4);
  }
}

/** AnomalyDetector (simplified for client-side). */
class AnomalyDetector {
  detect(
    currentRMS: number,
    profile: NoiseProfile | null,
    rmsHistory: number[]
  ): Array<{ type: string; details: any }> {
    if (!profile) return [];
    const anomalies = [];
    if (currentRMS > profile.peakRMS * 2.5 && currentRMS > 0.05) {
      anomalies.push({ type: 'sudden_loud_noise', details: { level: currentRMS, profilePeak: profile.peakRMS }});
    }
    if (profile.environmentType !== 'quiet' && currentRMS < profile.baselineRMS * 0.1 && profile.baselineRMS > 0.005) {
      anomalies.push({ type: 'sudden_silence_or_mute', details: { level: currentRMS, profileBaseline: profile.baselineRMS }});
    }
    // More advanced anomaly detection could be added here.
    return anomalies;
  }
}