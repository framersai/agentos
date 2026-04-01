// hearing/SilenceDetector.ts
import { EventEmitter } from 'events';
/**
 * SilenceDetector - Interprets VAD events to detect meaningful conversational silences.
 */
export class SilenceDetector extends EventEmitter {
    on(event, listener) {
        return super.on(event, listener);
    }
    emit(event, ...args) {
        return super.emit(event, ...args);
    }
    /**
     * Creates a new SilenceDetector instance.
     * @param {SilenceDetectorConfig} config - Configuration options.
     */
    constructor(config = {}) {
        super();
        this.vadIsCurrentlySpeaking = false; // Tracks VAD's speaking state
        this.silenceAfterSpeechStartTimeMs = null; // When silence began *after* speech
        this.lastSpeechEndTimeMs = null; // When VAD last reported speech_end or transitioned to no_voice_activity
        this.significantPauseAlreadyEmitted = false;
        this.silenceCheckIntervalTimer = null;
        this.config = {
            significantPauseThresholdMs: config.significantPauseThresholdMs || 1500,
            utteranceEndThresholdMs: config.utteranceEndThresholdMs || 3000,
            minSilenceTimeToConsiderAfterSpeech: config.minSilenceTimeToConsiderAfterSpeech || 500,
            silenceCheckIntervalMs: config.silenceCheckIntervalMs || 250,
        };
        if (this.config.significantPauseThresholdMs >= this.config.utteranceEndThresholdMs) {
            console.warn("SilenceDetectorConfig: significantPauseThresholdMs should be less than utteranceEndThresholdMs. Adjusting.");
            this.config.significantPauseThresholdMs = Math.max(500, this.config.utteranceEndThresholdMs - 500);
        }
        if (this.config.minSilenceTimeToConsiderAfterSpeech >= this.config.significantPauseThresholdMs) {
            console.warn("SilenceDetectorConfig: minSilenceTimeToConsiderAfterSpeech should be less than significantPauseThresholdMs. Adjusting.");
            this.config.minSilenceTimeToConsiderAfterSpeech = Math.max(100, this.config.significantPauseThresholdMs - 200);
        }
    }
    // --- Public methods to be called by AudioProcessor based on VAD events ---
    /**
     * Handles the `speech_start` event from AdaptiveVAD.
     * @param {VADResult} _vadResult - The VAD result associated with speech start.
     */
    handleSpeechStart(_vadResult) {
        // console.debug("SilenceDetector: VAD Speech Start");
        this.vadIsCurrentlySpeaking = true;
        this.clearSilenceState(); // Reset silence tracking
        this.stopSilenceCheckTimer();
    }
    /**
     * Handles the `voice_activity` event from AdaptiveVAD.
     * Call this for every frame VAD identifies as speech.
     * @param {VADResult} _vadResult - The VAD result for the active voice frame.
     */
    handleVoiceActivity(_vadResult) {
        // console.debug("SilenceDetector: VAD Voice Activity");
        this.vadIsCurrentlySpeaking = true; // Reaffirm
        this.clearSilenceState(); // Ongoing speech resets any incipient silence
        this.stopSilenceCheckTimer();
        this.lastSpeechEndTimeMs = null; // No definitive speech end yet
    }
    /**
     * Handles the `no_voice_activity` event from AdaptiveVAD.
     * Call this for every frame VAD identifies as non-speech.
     * @param {VADResult} _vadResult - The VAD result for the non-speech frame.
     */
    handleNoVoiceActivity(_vadResult) {
        // console.debug("SilenceDetector: VAD No Voice Activity");
        if (this.vadIsCurrentlySpeaking) { // This means speech just transitioned to silence
            // This is the first moment of silence AFTER speech
            this.vadIsCurrentlySpeaking = false; // VAD is no longer reporting active speech frames
            this.lastSpeechEndTimeMs = Date.now(); // Mark when VAD reported end of active speech signal
            if (!this.silenceAfterSpeechStartTimeMs) {
                this.silenceAfterSpeechStartTimeMs = this.lastSpeechEndTimeMs;
                this.significantPauseAlreadyEmitted = false;
                this.emit('post_speech_silence_started');
                // console.debug(`SilenceDetector: Post-speech silence started at ${this.silenceAfterSpeechStartTimeMs}`);
            }
            this.startSilenceCheckTimer(); // Start checking for pause/utterance end
        }
        else if (this.silenceAfterSpeechStartTimeMs) {
            // Silence continues after speech, timer will handle checks.
            // Ensure timer is running if it somehow stopped.
            this.startSilenceCheckTimer();
        }
        // If !this.vadIsCurrentlySpeaking and !this.silenceAfterSpeechStartTimeMs, it's just ongoing silence before any speech, which we don't act on.
    }
    /**
     * Handles the `speech_end` event from AdaptiveVAD.
     * This signifies VAD has determined a speech segment is over due to its internal pause limits.
     * @param {VADResult} _vadResult - The VAD result associated with speech end.
     * @param {number} _speechDurationMs - The duration of the speech segment as determined by VAD.
     */
    handleSpeechEnd(_vadResult, _speechDurationMs) {
        // console.debug(`SilenceDetector: VAD Speech End. Duration: ${speechDurationMs}ms`);
        this.vadIsCurrentlySpeaking = false;
        this.lastSpeechEndTimeMs = Date.now(); // Mark when VAD confirmed speech segment end
        if (!this.silenceAfterSpeechStartTimeMs) {
            this.silenceAfterSpeechStartTimeMs = this.lastSpeechEndTimeMs;
            this.significantPauseAlreadyEmitted = false;
            this.emit('post_speech_silence_started');
            // console.debug(`SilenceDetector: Post-speech silence started (after VAD speech_end) at ${this.silenceAfterSpeechStartTimeMs}`);
        }
        this.startSilenceCheckTimer(); // Start checking for further pause/utterance end
    }
    // --- Internal logic ---
    clearSilenceState() {
        this.silenceAfterSpeechStartTimeMs = null;
        this.significantPauseAlreadyEmitted = false;
        this.lastSpeechEndTimeMs = null;
    }
    startSilenceCheckTimer() {
        if (this.silenceCheckIntervalTimer)
            return; // Already running
        this.silenceCheckIntervalTimer = setInterval(() => {
            this.checkSilenceDuration();
        }, this.config.silenceCheckIntervalMs);
        // console.debug("SilenceDetector: Silence check timer started.");
    }
    stopSilenceCheckTimer() {
        if (this.silenceCheckIntervalTimer) {
            clearInterval(this.silenceCheckIntervalTimer);
            this.silenceCheckIntervalTimer = null;
            // console.debug("SilenceDetector: Silence check timer stopped.");
        }
    }
    /**
     * Called periodically by the interval timer to check current silence duration.
     */
    checkSilenceDuration() {
        if (!this.silenceAfterSpeechStartTimeMs || this.vadIsCurrentlySpeaking) {
            // If speech has resumed or silence never really started after speech, stop checking.
            this.stopSilenceCheckTimer();
            this.clearSilenceState();
            return;
        }
        const now = Date.now();
        const silenceDurationMs = now - this.silenceAfterSpeechStartTimeMs;
        // Ensure enough time has passed since actual speech ended, as per config
        if (this.lastSpeechEndTimeMs && (now - this.lastSpeechEndTimeMs < this.config.minSilenceTimeToConsiderAfterSpeech)) {
            // console.debug(`SilenceDetector: Waiting for minSilenceTimeToConsiderAfterSpeech (${silenceDurationMs}ms / ${this.config.minSilenceTimeToConsiderAfterSpeech}ms)`);
            return; // Not enough silence yet post-speech to consider it for major events.
        }
        // Check for utterance_end first, as it's the longer duration
        if (silenceDurationMs >= this.config.utteranceEndThresholdMs) {
            this.emit('utterance_end_detected', silenceDurationMs);
            // console.debug(`SilenceDetector: Utterance end detected. Duration: ${silenceDurationMs}ms`);
            this.clearSilenceState(); // Reset for next utterance
            this.stopSilenceCheckTimer(); // Stop checking once utterance ended
            return; // Important: return after utterance end to not also emit significant_pause
        }
        // Check for significant_pause
        if (!this.significantPauseAlreadyEmitted &&
            silenceDurationMs >= this.config.significantPauseThresholdMs) {
            this.emit('significant_pause_detected', silenceDurationMs);
            // console.debug(`SilenceDetector: Significant pause detected. Duration: ${silenceDurationMs}ms`);
            this.significantPauseAlreadyEmitted = true; // Emit only once per pause period
        }
    }
    /**
     * Resets the SilenceDetector's internal state.
     * Should be called when a conversation or voice session is fully reset.
     */
    reset() {
        // console.log('🔄 SilenceDetector reset.');
        this.vadIsCurrentlySpeaking = false;
        this.clearSilenceState();
        this.stopSilenceCheckTimer();
    }
    /**
     * Call this when the component is being destroyed to clean up timers.
     */
    dispose() {
        this.stopSilenceCheckTimer();
        // console.log('🗑️ SilenceDetector disposed.');
    }
}
//# sourceMappingURL=SilenceDetector.js.map