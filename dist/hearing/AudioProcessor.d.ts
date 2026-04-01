/**
 * @fileoverview Main audio processing pipeline with environmental adaptation using Web Audio APIs.
 * This component is intended for client-side execution in a web browser.
 * @module hearing/AudioProcessor
 */
import { EventEmitter } from 'events';
import { NoiseProfile, CalibrationConfig } from './EnvironmentalCalibrator';
import { VADResult, AdaptiveVADConfig as LogicVADConfig, VADEmitterEvents } from './AdaptiveVAD';
/**
 * Configuration for the Web Audio API based AudioProcessor.
 * Note: `frameSize` here refers to the ScriptProcessorNode's buffer size.
 * The actual processing frame for VAD/Calibrator might be this size or smaller if sub-chunked.
 */
export interface WebAudioProcessorConfig {
    /** Sample rate for processing. AudioContext will try to match this. */
    sampleRate?: number;
    /**
     * Buffer size for the ScriptProcessorNode in samples. This determines the frequency of `onaudioprocess`.
     * Common values: 256, 512, 1024, 2048, 4096.
     * This also dictates the size of `audioFrame` given to VAD/Calibrator unless further chunking is done.
     */
    bufferSize?: number;
    /** Enable Automatic Gain Control (AGC) via a GainNode (conceptual placeholder for now). */
    enableAGC?: boolean;
}
/**
 * Represents the internal processing state of the AudioProcessor.
 */
export interface AudioProcessorState {
    isCalibratorCalibrated: boolean;
    isProcessing: boolean;
    currentEnvironmentType: NoiseProfile['environmentType'] | 'unknown';
    lastNoiseProfileUpdateMs: number;
    vadIsSpeaking: boolean;
}
/**
 * Represents a complete speech audio chunk captured by the processor.
 */
export interface SpeechAudioChunk {
    id: string;
    audioData: Float32Array;
    sampleRate: number;
    durationMs: number;
    startTimeMs: number;
    vadResultAtEnd: VADResult;
    noiseProfileContext?: NoiseProfile | null;
}
/**
 * Events emitted by the WebAudioProcessor.
 */
export interface WebAudioProcessorEvents extends VADEmitterEvents {
    'processor:initialized': () => void;
    'processor:started': () => void;
    'processor:stopped': () => void;
    'processor:error': (error: Error) => void;
    'processor:disposed': () => void;
    'calibration:started': () => void;
    'calibration:complete': (profile: NoiseProfile) => void;
    'profile:updated': (profile: NoiseProfile) => void;
    'anomaly:detected': (type: string, details: any, profile: NoiseProfile) => void;
    /** Emitted when a complete speech audio chunk is ready. */
    'speech_chunk_ready': (chunk: SpeechAudioChunk) => void;
    /** Raw audio frame from onaudioprocess, for debugging or other consumers. */
    'raw_audio_frame': (frame: Float32Array, sampleRate: number) => void;
}
/**
 * AudioProcessor - Central client-side audio processing pipeline using Web Audio APIs.
 * Orchestrates EnvironmentalCalibrator (web-version) and AdaptiveVAD (logic-version).
 */
export declare class AudioProcessor extends EventEmitter {
    private config;
    private calibrator;
    private vad;
    private audioContext;
    private mediaStream;
    private sourceNode;
    private processorNode;
    private gainNode;
    private isInitialized;
    private _isProcessing;
    private frameDurationMs;
    private speechDataBuffer;
    private currentSpeechStartTimeMs;
    private internalState;
    on<U extends keyof WebAudioProcessorEvents>(event: U, listener: WebAudioProcessorEvents[U]): this;
    emit<U extends keyof WebAudioProcessorEvents>(event: U, ...args: Parameters<WebAudioProcessorEvents[U]>): boolean;
    constructor(config?: WebAudioProcessorConfig, calibrationConfig?: CalibrationConfig, // For web-based EnvironmentalCalibrator
    vadConfig?: LogicVADConfig);
    private setupEventForwarding;
    /**
     * Initialize the audio processing pipeline with a given MediaStream.
     * @param {MediaStream} stream - The user's audio MediaStream.
     * @returns {Promise<void>}
     */
    initialize(stream: MediaStream): Promise<void>;
    /**
     * Start processing audio. Must be called after initialize.
     * Often requires user interaction to start AudioContext.
     */
    start(): Promise<void>;
    /** Stop processing audio. */
    stop(): void;
    private processAudioEvent;
    private isCurrentlySpeakingOrRecentlyEnded;
    private concatenateFloat32Arrays;
    /**
     * Get current processing state.
     * @returns {AudioProcessorState}
     */
    getInternalState(): AudioProcessorState;
    /**
     * Returns true if the audio processor is currently capturing and processing audio.
     */
    get isProcessing(): boolean;
    /**
     * Cleanly dispose of all Web Audio API resources.
     * @returns {Promise<void>}
     */
    dispose(): Promise<void>;
}
//# sourceMappingURL=AudioProcessor.d.ts.map