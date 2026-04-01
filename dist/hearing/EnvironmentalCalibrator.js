// hearing/EnvironmentalCalibrator.ts
/// <reference lib="dom" />
import { EventEmitter } from 'events';
/**
 * EnvironmentalCalibrator (Web Version) - Adapts to acoustic environment in real-time
 * using Web Audio APIs for initial calibration and processing raw frames for continuous updates.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class EnvironmentalCalibrator extends EventEmitter {
    /**
     * Creates a new EnvironmentalCalibrator instance.
     * @param {CalibrationConfig} config - Configuration options.
     */
    constructor(config = {}) {
        super();
        this.currentProfile = null;
        this.profileHistory = [];
        this.rmsValuesForContinuousAdapt = []; // Stores RMS of recent frames for continuous adaptation
        this.lastProfileUpdateTimeMs = Date.now();
        this.lastVoiceActivityTimeMs = Date.now(); // For resetting backoff
        this.isDuringInitialCalibration = false;
        // Web Audio API related properties for initial calibration
        this.calibrationAudioContext = null;
        this.calibrationSourceNode = null;
        this.calibrationProcessorNode = null;
        this.calibrationAnalyserNode = null;
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
    async calibrate(audioStream) {
        if (this.isDuringInitialCalibration) {
            console.warn("Calibration is already in progress.");
            return Promise.reject(new Error("Calibration already in progress."));
        }
        console.log(`🎤 Starting environmental calibration for ${this.config.initialCalibrationMs}ms (Web Audio)...`);
        this.isDuringInitialCalibration = true;
        this.emit('calibration:started');
        const collectedRmsSamples = [];
        const collectedFrequencySamples = [];
        let processedDuration = 0;
        return new Promise((resolve, reject) => {
            try {
                this.calibrationAudioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: this.config.sampleRate, // Attempt to use configured sample rate
                });
                // Check actual sample rate
                const actualSampleRate = this.calibrationAudioContext.sampleRate;
                if (Math.abs(actualSampleRate - this.config.sampleRate) > 100) {
                    console.warn(`Calibrator: AudioContext using sample rate ${actualSampleRate}Hz, configured was ${this.config.sampleRate}Hz.`);
                }
                this.calibrationSourceNode = this.calibrationAudioContext.createMediaStreamSource(audioStream);
                this.calibrationProcessorNode = this.calibrationAudioContext.createScriptProcessor(this.config.calibrationBufferSize, 1, // input channels
                1 // output channels
                );
                if (this.config.enableFrequencyAnalysis) {
                    this.calibrationAnalyserNode = this.calibrationAudioContext.createAnalyser();
                    this.calibrationAnalyserNode.fftSize = this.config.fftSize;
                    this.calibrationSourceNode.connect(this.calibrationAnalyserNode);
                    this.calibrationAnalyserNode.connect(this.calibrationProcessorNode);
                }
                else {
                    this.calibrationSourceNode.connect(this.calibrationProcessorNode);
                }
                this.calibrationProcessorNode.connect(this.calibrationAudioContext.destination); // Keep graph alive
                this.calibrationProcessorNode.onaudioprocess = (event) => {
                    if (!this.isDuringInitialCalibration)
                        return; // Stop processing if calibration ended prematurely
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
                        }
                        catch (analysisError) {
                            console.error("Error analyzing calibration data:", analysisError);
                            this.emit('calibration:error', analysisError);
                            reject(analysisError);
                        }
                        finally {
                            this.cleanupCalibrationAudioNodes();
                        }
                    }
                };
            }
            catch (error) {
                console.error('❌ Error setting up Web Audio for calibration:', error);
                this.isDuringInitialCalibration = false;
                this.emit('calibration:error', error);
                this.cleanupCalibrationAudioNodes(); // Ensure cleanup on setup error
                reject(error);
            }
        });
    }
    /** Cleans up Web Audio nodes used specifically for initial calibration. */
    cleanupCalibrationAudioNodes() {
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
    analyzeCalibrationSamples(rmsSamples, frequencySamples) {
        if (rmsSamples.length === 0) {
            throw new Error("Cannot analyze empty RMS samples for calibration.");
        }
        const sortedRms = [...rmsSamples].sort((a, b) => a - b);
        const baselineRMS = this.calculatePercentile(sortedRms, 0.25); // Robust baseline
        const peakRMS = this.calculatePercentile(sortedRms, 0.95);
        const noiseStdDev = this.calculateStdDev(rmsSamples, baselineRMS);
        let avgFrequencyProfile = undefined;
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
        const { speechThreshold, silenceThreshold } = this.calculateAdaptiveThresholds(baselineRMS, peakRMS, noiseStdDev, environmentType);
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
    continuousAdaptation(audioFrame) {
        if (this.isDuringInitialCalibration || !this.currentProfile) {
            // console.warn("Calibrator: Cannot perform continuous adaptation during initial calibration or without a profile.");
            return;
        }
        if (!audioFrame || audioFrame.length === 0)
            return;
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
            const stdDevChange = Math.abs(currentStdDev - this.currentProfile.noiseStdDev) / (this.currentProfile.noiseStdDev || 0.001);
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
            }
            else {
                this.currentBackoffIntervalMs = Math.min(this.currentBackoffIntervalMs * this.config.backoffMultiplier, this.config.maxBackoffIntervalMs);
            }
            this.lastProfileUpdateTimeMs = now;
        }
        this.detectAnomalies(rms);
    }
    /**
     * Helper to update profile based on current RMS history (primarily for continuous adaptation).
     */
    updateProfileFromRmsHistory(rmsHistory, baseProfile) {
        const sortedRms = [...rmsHistory].sort((a, b) => a - b);
        const baselineRMS = this.calculatePercentile(sortedRms, 0.25);
        const peakRMS = this.calculatePercentile(sortedRms, 0.95);
        const noiseStdDev = this.calculateStdDev(rmsHistory, baselineRMS);
        const environmentType = this.classifyEnvironment(baselineRMS, peakRMS, noiseStdDev);
        const { speechThreshold, silenceThreshold } = this.calculateAdaptiveThresholds(baselineRMS, peakRMS, noiseStdDev, environmentType);
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
    classifyEnvironment(baselineRMS, peakRMS, stdDev) {
        const dynamicRange = peakRMS - baselineRMS;
        const variability = baselineRMS > 0.0001 ? stdDev / baselineRMS : stdDev / 0.0001;
        if (baselineRMS < 0.008 && dynamicRange < 0.02 && variability < 0.5)
            return 'quiet';
        if (baselineRMS < 0.025 && dynamicRange < 0.05 && variability < 0.7)
            return 'normal';
        if (baselineRMS < 0.05 || dynamicRange < 0.1 || variability > 0.6)
            return 'noisy';
        return 'very_noisy';
    }
    /** Calculates adaptive speech and silence thresholds. */
    calculateAdaptiveThresholds(baselineRMS, peakRMS, stdDev, environment) {
        const multipliers = {
            quiet: { speechFactor: 2.8, silenceFactor: 1.8, stdDevFactor: 1.2 },
            normal: { speechFactor: 3.2, silenceFactor: 2.0, stdDevFactor: 1.5 },
            noisy: { speechFactor: 3.8, silenceFactor: 2.5, stdDevFactor: 1.8 },
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
    detectAnomalies(currentFrameRms) {
        const anomalies = this.anomalyDetector.detect(currentFrameRms, this.currentProfile, this.rmsValuesForContinuousAdapt);
        anomalies.forEach(anomaly => {
            this.emit('anomaly:detected', anomaly.type, anomaly.details, this.currentProfile);
        });
    }
    /** Records voice activity detection to reset backoff. */
    onVoiceActivityDetected() {
        this.lastVoiceActivityTimeMs = Date.now();
        this.currentBackoffIntervalMs = this.config.minBackoffIntervalMs;
    }
    getCurrentProfile() {
        return this.currentProfile ? { ...this.currentProfile } : null; // Return a copy
    }
    addToRmsHistory(rms) {
        this.rmsValuesForContinuousAdapt.push(rms);
        if (this.rmsValuesForContinuousAdapt.length > this.config.rmsHistoryBufferSize) {
            this.rmsValuesForContinuousAdapt.shift();
        }
    }
    calculateRMS(audioFrame) {
        let sumOfSquares = 0;
        for (let i = 0; i < audioFrame.length; i++)
            sumOfSquares += audioFrame[i] * audioFrame[i];
        return Math.sqrt(sumOfSquares / audioFrame.length);
    }
    calculatePercentile(sortedData, percentile) {
        if (sortedData.length === 0)
            return 0;
        const index = Math.floor(sortedData.length * percentile);
        return sortedData[Math.min(index, sortedData.length - 1)];
    }
    calculateStdDev(data, mean) {
        if (data.length < 2)
            return 0;
        const m = mean !== undefined ? mean : data.reduce((s, v) => s + v, 0) / data.length;
        const variance = data.reduce((acc, val) => acc + (val - m) ** 2, 0) / data.length;
        return Math.sqrt(variance);
    }
    calculateConfidence(rmsValues, stdDev) {
        if (rmsValues.length === 0)
            return 0;
        const dataQuantityFactor = Math.min(rmsValues.length / this.config.rmsHistoryBufferSize, 1.0); // For continuous, or initialCalibrationFrames for initial
        const meanRms = rmsValues.reduce((s, v) => s + v, 0) / rmsValues.length;
        let stabilityFactor = 0.5;
        if (meanRms > 0.0001)
            stabilityFactor = Math.max(0, 1 - (stdDev / meanRms));
        if (meanRms < 0.01 && stdDev < 0.005)
            stabilityFactor = Math.max(stabilityFactor, 0.75);
        return (dataQuantityFactor * 0.6 + stabilityFactor * 0.4);
    }
}
/** AnomalyDetector (simplified for client-side). */
class AnomalyDetector {
    detect(currentRMS, profile, _rmsHistory) {
        if (!profile)
            return [];
        const anomalies = [];
        if (currentRMS > profile.peakRMS * 2.5 && currentRMS > 0.05) {
            anomalies.push({ type: 'sudden_loud_noise', details: { level: currentRMS, profilePeak: profile.peakRMS } });
        }
        if (profile.environmentType !== 'quiet' && currentRMS < profile.baselineRMS * 0.1 && profile.baselineRMS > 0.005) {
            anomalies.push({ type: 'sudden_silence_or_mute', details: { level: currentRMS, profileBaseline: profile.baselineRMS } });
        }
        // More advanced anomaly detection could be added here.
        return anomalies;
    }
}
//# sourceMappingURL=EnvironmentalCalibrator.js.map