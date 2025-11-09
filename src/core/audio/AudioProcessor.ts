// backend/agentos/core/audio/AudioProcessor.ts
/**
 * @fileoverview Main audio processing pipeline with environmental adaptation using Web Audio APIs.
 * This component is intended for client-side execution in a web browser.
 * @module agentos/core/audio/AudioProcessor
 */
import { EventEmitter } from 'events';
// EnvironmentalCalibrator will be your web-based version
import { EnvironmentalCalibrator, NoiseProfile, CalibrationConfig } from './EnvironmentalCalibrator';
// AdaptiveVAD is the logic-based one we created
import { AdaptiveVAD, VADResult, AdaptiveVADConfig as LogicVADConfig, VADEmitterEvents } from './AdaptiveVAD';

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
  bufferSize?: number; // This is the ScriptProcessorNode's buffer size
  /** Enable Automatic Gain Control (AGC) via a GainNode (conceptual placeholder for now). */
  enableAGC?: boolean;
  /** Echo cancellation (usually a browser media track constraint, not directly controlled here). */
  // enableEchoCancellation?: boolean; // More of a MediaTrackConstraints setting
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
  startTimeMs: number; // Timestamp of speech start
  vadResultAtEnd: VADResult; // VAD result that triggered speech_end
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

  'calibration:started': () => void; // Forwarded
  'calibration:complete': (profile: NoiseProfile) => void; // Forwarded
  'profile:updated': (profile: NoiseProfile) => void; // Forwarded
  'anomaly:detected': (type: string, details: any, profile: NoiseProfile) => void; // Forwarded

  /** Emitted when a complete speech audio chunk is ready. */
  'speech_chunk_ready': (chunk: SpeechAudioChunk) => void;

  /** Raw audio frame from onaudioprocess, for debugging or other consumers. */
  'raw_audio_frame': (frame: Float32Array, sampleRate: number) => void;
}

export declare interface AudioProcessor {
  on<U extends keyof WebAudioProcessorEvents>(event: U, listener: WebAudioProcessorEvents[U]): this;
  emit<U extends keyof WebAudioProcessorEvents>(event: U, ...args: Parameters<WebAudioProcessorEvents[U]>): boolean;
}

/**
 * AudioProcessor - Central client-side audio processing pipeline using Web Audio APIs.
 * Orchestrates EnvironmentalCalibrator (web-version) and AdaptiveVAD (logic-version).
 */
export class AudioProcessor extends EventEmitter {
  private config: Required<WebAudioProcessorConfig>;
  private calibrator: EnvironmentalCalibrator; // Web Audio API version
  private vad: AdaptiveVAD; // Logic-based version

  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private gainNode: GainNode | null = null; // For potential AGC

  private isInitialized: boolean = false;
  private _isProcessing: boolean = false;
  private frameDurationMs: number; // Duration of frames from ScriptProcessorNode

  private speechDataBuffer: Float32Array[] = []; // To accumulate speech frames
  private currentSpeechStartTimeMs: number | null = null;

  private internalState: AudioProcessorState;

  constructor(
    config: WebAudioProcessorConfig = {},
    calibrationConfig: CalibrationConfig = {}, // For web-based EnvironmentalCalibrator
    vadConfig: LogicVADConfig = {}          // For logic-based AdaptiveVAD
  ) {
    super();

    this.config = {
      sampleRate: config.sampleRate || 16000,
      bufferSize: config.bufferSize || 4096, // ScriptProcessorNode buffer size
      enableAGC: config.enableAGC ?? false,
    };

    // Calculate frame duration based on ScriptProcessorNode's output
    this.frameDurationMs = (this.config.bufferSize / this.config.sampleRate) * 1000;
    if (this.frameDurationMs <= 0 || !isFinite(this.frameDurationMs)) {
        throw new Error(`AudioProcessor: Invalid frame duration (${this.frameDurationMs}ms). Check bufferSize (${this.config.bufferSize}) and sampleRate (${this.config.sampleRate}).`);
    }

    // Instantiate the WEB-BASED EnvironmentalCalibrator
    // It will use Web Audio APIs for its 'calibrate(stream)' method.
    this.calibrator = new EnvironmentalCalibrator({
      ...calibrationConfig,
      sampleRate: this.config.sampleRate, // It needs sampleRate
      // If its 'calibrate' uses its own AnalyserNode, it might need bufferSize too.
    });

    // Instantiate the LOGIC-BASED AdaptiveVAD
    this.vad = new AdaptiveVAD(
      vadConfig,
      this.calibrator, // VAD uses the calibrator instance
      this.frameDurationMs // VAD needs to know the duration of frames it will receive
    );

    this.internalState = {
        isCalibratorCalibrated: false,
        isProcessing: false,
        currentEnvironmentType: 'unknown',
        lastNoiseProfileUpdateMs: 0,
        vadIsSpeaking: false,
    };

    this.setupEventForwarding();
  }

  private setupEventForwarding(): void {
    this.calibrator.on('calibration:started', () => this.emit('calibration:started'));
    this.calibrator.on('calibration:complete', (profile: NoiseProfile) => {
      this.internalState.isCalibratorCalibrated = true;
      this.internalState.currentEnvironmentType = profile.environmentType;
      this.internalState.lastNoiseProfileUpdateMs = profile.timestamp;
      this.emit('calibration:complete', profile);
    });
    this.calibrator.on('profile:updated', (profile: NoiseProfile) => {
      this.internalState.currentEnvironmentType = profile.environmentType;
      this.internalState.lastNoiseProfileUpdateMs = profile.timestamp;
      this.emit('profile:updated', profile);
    });
    this.calibrator.on('anomaly:detected', (type, details, profile) => {
        // The web-based calibrator might not pass 'profile' here, adjust if needed based on its signature.
        // Assuming it does based on previous refactor of Node.js version.
        this.emit('anomaly:detected', type, details, profile as NoiseProfile);
    });


    // VAD Event Handling
    this.vad.on('speech_start', (vadResult) => {
        this.speechDataBuffer = []; // Clear buffer for new speech segment
        this.currentSpeechStartTimeMs = Date.now() - this.frameDurationMs; // Approximate start to previous frame
        this.internalState.vadIsSpeaking = true;
        this.emit('speech_start', vadResult);
    });

    this.vad.on('voice_activity', (vadResult) => {
        // The frame causing this is handled in `processAudioEvent` to be added to buffer
        this.emit('voice_activity', vadResult);
    });

    this.vad.on('speech_end', (vadResult, speechDurationMs) => {
        this.internalState.vadIsSpeaking = false;
        this.emit('speech_end', vadResult, speechDurationMs);

        if (this.speechDataBuffer.length > 0 && this.currentSpeechStartTimeMs !== null) {
            const concatenatedAudio = this.concatenateFloat32Arrays(this.speechDataBuffer);
            const chunk: SpeechAudioChunk = {
                id: `spch_${Date.now()}`,
                audioData: concatenatedAudio,
                sampleRate: this.config.sampleRate,
                durationMs: speechDurationMs, // Use VAD's calculated duration
                startTimeMs: this.currentSpeechStartTimeMs,
                vadResultAtEnd: vadResult,
                noiseProfileContext: this.calibrator.getCurrentProfile()
            };
            this.emit('speech_chunk_ready', chunk);
        }
        this.speechDataBuffer = []; // Clear buffer
        this.currentSpeechStartTimeMs = null;
    });

    this.vad.on('thresholds_updated', (speech, silence, profile) => {
        this.emit('thresholds_updated', speech, silence, profile);
    });
  }

  /**
   * Initialize the audio processing pipeline with a given MediaStream.
   * @param {MediaStream} stream - The user's audio MediaStream.
   * @returns {Promise<void>}
   */
  async initialize(stream: MediaStream): Promise<void> {
    if (this.isInitialized) {
      console.warn('AudioProcessor already initialized.');
      return;
    }
    console.log('🎙️ Initializing Web AudioProcessor...');
    this.mediaStream = stream;

    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: this.config.sampleRate,
      });

      // Forcing sample rate can be tricky; browser might use its own.
      // It's better to adapt to audioContext.sampleRate if they differ significantly.
      if (Math.abs(this.audioContext.sampleRate - this.config.sampleRate) > 100) {
          console.warn(`AudioContext sample rate (${this.audioContext.sampleRate}Hz) differs significantly from configured (${this.config.sampleRate}Hz). Using AudioContext's rate.`);
          // Re-calculate frameDurationMs if sampleRate changed
          // this.config.sampleRate = this.audioContext.sampleRate; // Update config if we decide to follow context's rate
          // this.frameDurationMs = (this.config.bufferSize / this.config.sampleRate) * 1000;
          // TODO: Decide if VAD needs re-initialization or if its config can adapt.
      }


      this.sourceNode = this.audioContext.createMediaStreamSource(stream);
      this.gainNode = this.audioContext.createGain(); // For potential AGC

      this.processorNode = this.audioContext.createScriptProcessor(
        this.config.bufferSize,
        1, // input channels
        1  // output channels
      );

      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination); // Necessary to keep processing alive

      this.processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
        if (this._isProcessing) {
          this.processAudioEvent(event);
        }
      };

      // Start environmental calibration using the web-based calibrator
      // This version of 'calibrate' is from the user-provided EnvironmentalCalibrator,
      // which expects a MediaStream. We'll need to ensure it works correctly.
      console.log('🎤 Starting environmental calibration (web)...');
      this.emit('calibration:started'); // Emit our own event
      await this.calibrator.calibrate(stream); // This should internally use the stream
                                               // and emit 'calibration:complete' itself.

      this.isInitialized = true;
      this.emit('processor:initialized');
      console.log('✅ Web AudioProcessor initialized.');

    } catch (error) {
      console.error('❌ Failed to initialize Web AudioProcessor:', error);
      this.emit('processor:error', error as Error);
      await this.dispose();
      throw error;
    }
  }

  /**
   * Start processing audio. Must be called after initialize.
   * Often requires user interaction to start AudioContext.
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('AudioProcessor not initialized. Call initialize() first.');
    }
    if (this._isProcessing) {
      console.warn('AudioProcessor is already processing.');
      return;
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
        console.log('AudioContext resumed successfully.');
      } catch (err) {
        console.error('Error resuming AudioContext:', err);
        this.emit('processor:error', new Error('Failed to resume AudioContext. User interaction might be required.'));
        return;
      }
    }

    this._isProcessing = true;
    this.internalState.isProcessing = true;
    this.vad.resetState(); // Reset VAD state when starting
    console.log('▶️ Web Audio processing started.');
    this.emit('processor:started');
  }

  /** Stop processing audio. */
  stop(): void {
    if (!this._isProcessing) return;
    this._isProcessing = false;
    this.internalState.isProcessing = false;
    console.log('⏹️ Web Audio processing stopped.');
    this.emit('processor:stopped');
  }

  private processAudioEvent(event: AudioProcessingEvent): void {
    const audioFrame = new Float32Array(event.inputBuffer.getChannelData(0)); // Get a copy
    this.emit('raw_audio_frame', audioFrame, this.audioContext?.sampleRate ?? this.config.sampleRate);

    // 1. Pass frame to EnvironmentalCalibrator for continuous adaptation
    // The web-based calibrator's `continuousAdaptation` takes a Float32Array.
    if (this.internalState.isCalibratorCalibrated) { // Only adapt after initial calibration
        this.calibrator.continuousAdaptation(audioFrame);
    }

    // 2. Pass frame to AdaptiveVAD
    const vadResult = this.vad.processFrame(audioFrame);
    this.internalState.vadIsSpeaking = this.vad.getCurrentState().isSpeaking; // Update internal state

    // 3. Buffer audio if VAD indicates speech
    if (this.internalState.vadIsSpeaking || this.speechDataBuffer.length > 0) {
      // Add to buffer if VAD says it's speech, OR if we were accumulating and it might be the tail end.
      // The VAD's speech_end logic will determine if the buffer forms a valid chunk.
      const vadConfig = this.vad.getConfig();
      if (vadResult.isSpeech || (this.isCurrentlySpeakingOrRecentlyEnded() && this.speechDataBuffer.length < ( (this.vad.getCurrentState().consecutiveSilenceFrames * this.frameDurationMs) < vadConfig.maxSilenceDurationMsInSpeech ? 100 : 0 ) ) ) { // Heuristic to grab trailing audio frames
           this.speechDataBuffer.push(audioFrame.slice()); // Store a copy
      }
    }
  }

  // Helper to check if VAD is speaking or was speaking very recently (within one frame)
  private isCurrentlySpeakingOrRecentlyEnded(): boolean {
    const vadState = this.vad.getCurrentState();
    return vadState.isSpeaking || (vadState.consecutiveSilenceFrames * this.frameDurationMs < this.frameDurationMs * 2 );
  }


  private concatenateFloat32Arrays(arrays: Float32Array[]): Float32Array {
    let totalLength = 0;
    for (const arr of arrays) {
      totalLength += arr.length;
    }
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }

  /**
   * Get current processing state.
   * @returns {AudioProcessorState}
   */
  public getInternalState(): AudioProcessorState {
      return { ...this.internalState, vadIsSpeaking: this.vad.getCurrentState().isSpeaking };
  }

  /**
   * Returns true if the audio processor is currently capturing and processing audio.
   */
  get isProcessing(): boolean {
    return this._isProcessing;
  }

  /**
   * Cleanly dispose of all Web Audio API resources.
   * @returns {Promise<void>}
   */
  async dispose(): Promise<void> {
    console.log('🗑️ Disposing Web AudioProcessor...');
    this.stop();
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
    }
    if (this.gainNode) this.gainNode.disconnect();
    if (this.sourceNode) this.sourceNode.disconnect();

    this.mediaStream?.getTracks().forEach(track => track.stop());

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close();
      } catch (e) {
        console.warn("Error closing AudioContext:", e);
      }
    }
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.gainNode = null;
    this.mediaStream = null;
    this.isInitialized = false;
    this.speechDataBuffer = [];
    console.log('🚮 Web AudioProcessor disposed.');
    this.emit('processor:disposed');
  }
}
