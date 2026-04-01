// hearing/AdaptiveVAD.ts
import { EventEmitter } from 'events';
/**
 * AdaptiveVAD - Detects speech in audio frames, adapting to environmental noise.
 */
export class AdaptiveVAD extends EventEmitter {
    // Strongly typed event helpers
    on(event, listener) {
        return super.on(event, listener);
    }
    emit(event, ...args) {
        return super.emit(event, ...args);
    }
    /**
     * Creates a new AdaptiveVAD instance.
     * @param {AdaptiveVADConfig} config - VAD configuration options.
     * @param {EnvironmentalCalibrator} calibrator - Instance of EnvironmentalCalibrator for noise profiles.
     * @param {number} frameDurationMs - Duration of each audio frame in milliseconds that will be processed.
     * (e.g., for 16000Hz and 320 samples/frame, duration is 20ms).
     */
    constructor(config = {}, calibrator, frameDurationMs) {
        super();
        // Current dynamic thresholds
        this.currentSpeechThreshold = 0;
        this.currentSilenceThreshold = 0;
        // State variables
        this.isCurrentlySpeaking = false;
        this.speechSegmentStartTimeMs = null;
        this.silenceSegmentStartTimeMs = null;
        this.consecutiveSpeechFrames = 0;
        this.consecutiveSilenceFrames = 0;
        this.energyHistory = []; // For smoothing
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
        }
        else {
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
    updateThresholds(profile) {
        // Use suggested thresholds from profile and apply VAD-specific sensitivity
        // The profile's suggestedSilenceThreshold is a good starting point.
        const baseSilenceThreshold = profile.suggestedSilenceThreshold;
        // Apply VAD sensitivity factor
        this.currentSilenceThreshold = baseSilenceThreshold * this.config.vadSensitivityFactor;
        this.currentSpeechThreshold = Math.max(profile.suggestedSpeechThreshold * this.config.vadSensitivityFactor, this.currentSilenceThreshold * this.config.thresholdRatio // Ensure speech threshold is notably higher
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
    processFrame(audioFrame) {
        if (!audioFrame || audioFrame.length === 0) {
            console.warn('AdaptiveVAD: Received empty audio frame.');
            const emptyResult = {
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
        const vadResult = {
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
            }
            else {
                vadResult.isSpeech = true; // Speech continues
                this.handleVoiceActivity(vadResult);
            }
        }
        else {
            // If not speaking, look for energy to rise above SPEECH threshold to start
            if (smoothedEnergy > this.currentSpeechThreshold) {
                vadResult.isSpeech = true; // Tentatively, might be a short blip
                this.handleVoiceActivity(vadResult);
            }
            else {
                vadResult.isSpeech = false; // Silence continues
                this.handleNoVoiceActivity(vadResult);
            }
        }
        return vadResult;
    }
    handleVoiceActivity(result) {
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
    handleNoVoiceActivity(result) {
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
    calculateRMS(audioFrame) {
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
    getSmoothedEnergy(currentFrameEnergy) {
        this.energyHistory.push(currentFrameEnergy);
        if (this.energyHistory.length > this.config.energySmoothingFrames) {
            this.energyHistory.shift();
        }
        if (this.energyHistory.length === 0)
            return 0;
        // Simple moving average
        const sum = this.energyHistory.reduce((s, val) => s + val, 0);
        return sum / this.energyHistory.length;
    }
    /**
     * Resets the VAD's internal state.
     * Useful when starting a new audio stream or after a manual interruption.
     */
    resetState() {
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
    getCurrentState() {
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
    getConfig() {
        return { ...this.config };
    }
}
//# sourceMappingURL=AdaptiveVAD.js.map