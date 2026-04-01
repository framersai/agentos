import { EventEmitter } from 'node:events';
import type { SpeechSessionConfig, SpeechSessionAudioCapture, SpeechSessionBoundaryReason, SpeechSessionEventMap, SpeechSessionProviders, SpeechSessionState, SpeechSynthesisOptions, SpeechTranscriptionOptions } from './types.js';
export declare class SpeechSession extends EventEmitter {
    private readonly config;
    private readonly providers;
    private readonly calibrator;
    private readonly vad;
    private readonly silenceDetector;
    private state;
    private readonly capturedFrames;
    private currentSpeechStartedAt;
    private wakeWordDetected;
    private transcriptionPromise;
    private lastExternalVadSpeech;
    on<U extends keyof SpeechSessionEventMap>(event: U, listener: SpeechSessionEventMap[U]): this;
    emit<U extends keyof SpeechSessionEventMap>(event: U, ...args: Parameters<SpeechSessionEventMap[U]>): boolean;
    constructor(config?: SpeechSessionConfig, providers?: SpeechSessionProviders);
    getState(): SpeechSessionState;
    start(): Promise<void>;
    stop(): Promise<void>;
    flush(reason?: SpeechSessionBoundaryReason): Promise<void>;
    close(): Promise<void>;
    ingestFrame(frame: Float32Array): Promise<void>;
    transcribeAudio(audioBuffer: Buffer, options?: SpeechTranscriptionOptions, captureOverride?: SpeechSessionAudioCapture): Promise<void>;
    speak(text: string, options?: SpeechSynthesisOptions): Promise<import("./types.js").SpeechSynthesisResult>;
    interrupt(): void;
    private bindVadEvents;
    private bindSilenceEvents;
    private handleExternalVadDecision;
    private finalizeUtterance;
    private createCapture;
    private resetBuffers;
    private createSyntheticVadResult;
    private changeState;
    private handleError;
}
//# sourceMappingURL=SpeechSession.d.ts.map