import { EventEmitter } from 'events';
import { VADResult } from './AdaptiveVAD';
/**
 * @fileoverview Intelligent silence detection for continuous listening scenarios.
 * Interprets events and states from AdaptiveVAD to determine meaningful silences
 * like pauses and utterance endings, suitable for a web-based client.
 * @module hearing/SilenceDetector
 */
/**
 * Configuration for the SilenceDetector.
 */
export interface SilenceDetectorConfig {
    /**
     * Minimum duration of continuous silence (ms) after speech has ended
     * to be considered a "significant pause". This might indicate the user is thinking
     * or expecting a response.
     * @default 1500 ms
     */
    significantPauseThresholdMs?: number;
    /**
     * Maximum duration of continuous silence (ms) after speech has ended
     * before considering the user's utterance fully complete.
     * This should typically be longer than `significantPauseThresholdMs`.
     * @default 3000 ms
     */
    utteranceEndThresholdMs?: number;
    /**
     * After VAD signals `speech_start`, how long (ms) must silence persist
     * before it's considered for `significant_pause` or `utterance_end`.
     * This prevents cutting off very short speech segments immediately if followed by silence.
     * Should be less than `significantPauseThresholdMs`.
     * @default 500 ms
     */
    minSilenceTimeToConsiderAfterSpeech?: number;
    /**
     * Polling interval in milliseconds to check silence duration if no new VAD events occur.
     * This ensures long silences are detected even if VAD remains in a 'no_voice_activity' state.
     * @default 250 ms
     */
    silenceCheckIntervalMs?: number;
}
/**
 * Events emitted by the SilenceDetector.
 */
export interface SilenceDetectorEvents {
    /** Emitted when a significant pause is detected after speech. */
    'significant_pause_detected': (pauseDurationMs: number) => void;
    /** Emitted when an utterance is considered ended due to prolonged silence after speech. */
    'utterance_end_detected': (totalSilenceDurationMs: number) => void;
    /** Emitted when VAD indicates silence immediately following a speech segment. */
    'post_speech_silence_started': () => void;
}
/**
 * SilenceDetector - Interprets VAD events to detect meaningful conversational silences.
 */
export declare class SilenceDetector extends EventEmitter {
    private config;
    private vadIsCurrentlySpeaking;
    private silenceAfterSpeechStartTimeMs;
    private lastSpeechEndTimeMs;
    private significantPauseAlreadyEmitted;
    private silenceCheckIntervalTimer;
    on<U extends keyof SilenceDetectorEvents>(event: U, listener: SilenceDetectorEvents[U]): this;
    emit<U extends keyof SilenceDetectorEvents>(event: U, ...args: Parameters<SilenceDetectorEvents[U]>): boolean;
    /**
     * Creates a new SilenceDetector instance.
     * @param {SilenceDetectorConfig} config - Configuration options.
     */
    constructor(config?: SilenceDetectorConfig);
    /**
     * Handles the `speech_start` event from AdaptiveVAD.
     * @param {VADResult} _vadResult - The VAD result associated with speech start.
     */
    handleSpeechStart(_vadResult: VADResult): void;
    /**
     * Handles the `voice_activity` event from AdaptiveVAD.
     * Call this for every frame VAD identifies as speech.
     * @param {VADResult} _vadResult - The VAD result for the active voice frame.
     */
    handleVoiceActivity(_vadResult: VADResult): void;
    /**
     * Handles the `no_voice_activity` event from AdaptiveVAD.
     * Call this for every frame VAD identifies as non-speech.
     * @param {VADResult} _vadResult - The VAD result for the non-speech frame.
     */
    handleNoVoiceActivity(_vadResult: VADResult): void;
    /**
     * Handles the `speech_end` event from AdaptiveVAD.
     * This signifies VAD has determined a speech segment is over due to its internal pause limits.
     * @param {VADResult} _vadResult - The VAD result associated with speech end.
     * @param {number} _speechDurationMs - The duration of the speech segment as determined by VAD.
     */
    handleSpeechEnd(_vadResult: VADResult, _speechDurationMs: number): void;
    private clearSilenceState;
    private startSilenceCheckTimer;
    private stopSilenceCheckTimer;
    /**
     * Called periodically by the interval timer to check current silence duration.
     */
    private checkSilenceDuration;
    /**
     * Resets the SilenceDetector's internal state.
     * Should be called when a conversation or voice session is fully reset.
     */
    reset(): void;
    /**
     * Call this when the component is being destroyed to clean up timers.
     */
    dispose(): void;
}
//# sourceMappingURL=SilenceDetector.d.ts.map