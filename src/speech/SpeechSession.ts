import { EventEmitter } from 'node:events';
import { AdaptiveVAD } from '../hearing/AdaptiveVAD.js';
import type { VADResult } from '../hearing/AdaptiveVAD.js';
import { EnvironmentalCalibrator } from '../hearing/EnvironmentalCalibrator.js';
import { SilenceDetector } from '../hearing/SilenceDetector.js';
import { encodeFloat32ToWav } from './audio.js';
import type {
  SpeechSessionConfig,
  SpeechSessionAudioCapture,
  SpeechSessionBoundaryReason,
  SpeechSessionEventMap,
  SpeechSessionProviders,
  SpeechSessionState,
  SpeechSynthesisOptions,
  SpeechTranscriptionOptions,
  SpeechVadDecision,
} from './types.js';

export class SpeechSession extends EventEmitter {
  private readonly config: Required<
    Pick<
      SpeechSessionConfig,
      'mode' | 'sampleRate' | 'frameDurationMs' | 'audioFileName' | 'autoTranscribeOnSpeechEnd'
    >
  > &
    SpeechSessionConfig;
  private readonly providers: SpeechSessionProviders;
  private readonly calibrator: EnvironmentalCalibrator;
  private readonly vad: AdaptiveVAD;
  private readonly silenceDetector: SilenceDetector;
  private state: SpeechSessionState = 'idle';
  private readonly capturedFrames: Float32Array[] = [];
  private currentSpeechStartedAt: number | null = null;
  private wakeWordDetected = false;
  private transcriptionPromise: Promise<void> | null = null;
  private lastExternalVadSpeech = false;

  public override on<U extends keyof SpeechSessionEventMap>(
    event: U,
    listener: SpeechSessionEventMap[U]
  ): this {
    return super.on(event, listener);
  }

  public override emit<U extends keyof SpeechSessionEventMap>(
    event: U,
    ...args: Parameters<SpeechSessionEventMap[U]>
  ): boolean {
    return super.emit(event, ...args);
  }

  constructor(config: SpeechSessionConfig = {}, providers: SpeechSessionProviders = {}) {
    super();
    this.config = {
      mode: config.mode ?? 'vad',
      sampleRate: config.sampleRate ?? 16_000,
      frameDurationMs: config.frameDurationMs ?? 20,
      audioFileName: config.audioFileName ?? 'speech-session.wav',
      autoTranscribeOnSpeechEnd: config.autoTranscribeOnSpeechEnd ?? true,
      ...config,
    };
    this.providers = providers;
    this.calibrator = new EnvironmentalCalibrator({
      sampleRate: this.config.sampleRate,
    });
    this.vad = new AdaptiveVAD(
      this.config.vad ?? {},
      this.calibrator,
      this.config.frameDurationMs
    );
    this.silenceDetector = new SilenceDetector(this.config.silence ?? {});
    this.bindVadEvents();
    this.bindSilenceEvents();
  }

  getState(): SpeechSessionState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state === 'closed') {
      throw new Error('SpeechSession is closed.');
    }
    if (this.config.mode === 'wake-word') {
      if (!this.providers.wakeWord) {
        throw new Error('Wake-word mode requires a wake-word provider.');
      }
      this.wakeWordDetected = false;
      this.changeState('wake-listening');
      return;
    }
    this.changeState('listening');
  }

  async stop(): Promise<void> {
    this.resetBuffers();
    this.changeState('idle');
  }

  async flush(reason: SpeechSessionBoundaryReason = 'manual'): Promise<void> {
    await this.finalizeUtterance(reason);
  }

  async close(): Promise<void> {
    this.resetBuffers();
    this.silenceDetector.dispose();
    this.providers.wakeWord?.dispose?.();
    this.changeState('closed');
  }

  async ingestFrame(frame: Float32Array): Promise<void> {
    if (this.state === 'closed' || this.state === 'idle') return;

    if (this.config.mode === 'wake-word' && !this.wakeWordDetected) {
      const detection = await this.providers.wakeWord?.detect(frame, this.config.sampleRate);
      if (detection) {
        this.wakeWordDetected = true;
        this.emit('wake_word_detected', { detection });
        this.changeState('listening');
      }
      return;
    }

    if (this.providers.vad) {
      const decision = this.providers.vad.processFrame(frame);
      this.emit('vad_result', decision);
      this.handleExternalVadDecision(decision);
      const shouldCapture =
        this.capturedFrames.length > 0 || decision.isSpeech || this.lastExternalVadSpeech;
      if (shouldCapture) {
        this.capturedFrames.push(new Float32Array(frame));
      }
      this.lastExternalVadSpeech = decision.isSpeech;
      return;
    }

    const result = this.vad.processFrame(frame);
    const decision: SpeechVadDecision = {
      isSpeech: result.isSpeech,
      confidence: result.confidence,
      result,
      profile: this.calibrator.getCurrentProfile(),
    };
    this.emit('vad_result', decision);

    const shouldCapture =
      this.capturedFrames.length > 0 || result.isSpeech || this.vad.getCurrentState().isSpeaking;
    if (shouldCapture) {
      this.capturedFrames.push(new Float32Array(frame));
    }
  }

  async transcribeAudio(
    audioBuffer: Buffer,
    options: SpeechTranscriptionOptions = {},
    captureOverride?: SpeechSessionAudioCapture
  ): Promise<void> {
    if (!this.providers.stt) {
      throw new Error('No speech-to-text provider configured.');
    }
    this.changeState('transcribing');
    try {
      const capture = captureOverride ?? this.createCapture(audioBuffer);
      const result = await this.providers.stt.transcribe(
        {
          data: audioBuffer,
          fileName: capture.fileName,
          mimeType: capture.mimeType,
          format: 'wav',
          sampleRate: capture.sampleRate,
          durationSeconds: capture.durationMs / 1000,
        },
        {
          ...this.config.sttOptions,
          ...options,
        }
      );
      this.emit('transcript_final', { result, capture });
      this.changeState(this.config.mode === 'wake-word' ? 'wake-listening' : 'listening');
      this.wakeWordDetected = false;
    } catch (error) {
      this.handleError(error);
    }
  }

  async speak(text: string, options: SpeechSynthesisOptions = {}) {
    if (!this.providers.tts) {
      throw new Error('No text-to-speech provider configured.');
    }
    this.changeState('playing');
    this.emit('synthesis_started', { text });
    try {
      const result = await this.providers.tts.synthesize(text, {
        ...this.config.ttsOptions,
        ...options,
      });
      this.emit('synthesis_completed', { text, result });
      this.changeState(this.config.mode === 'wake-word' ? 'wake-listening' : 'listening');
      this.wakeWordDetected = false;
      return result;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  interrupt(): void {
    this.resetBuffers();
    this.changeState('interrupted');
    this.changeState(this.config.mode === 'wake-word' ? 'wake-listening' : 'listening');
  }

  private bindVadEvents(): void {
    this.vad.on('speech_start', (result) => {
      this.currentSpeechStartedAt = Date.now();
      this.changeState('capturing');
      this.emit('speech_started', {
        timestamp: this.currentSpeechStartedAt,
        vad: result,
      });
      this.silenceDetector.handleSpeechStart(result);
    });

    this.vad.on('voice_activity', (result) => {
      this.silenceDetector.handleVoiceActivity(result);
    });

    this.vad.on('no_voice_activity', (result) => {
      this.silenceDetector.handleNoVoiceActivity(result);
    });

    this.vad.on('speech_end', (result, durationMs) => {
      this.emit('speech_ended', {
        timestamp: Date.now(),
        vad: result,
        durationMs,
      });
      this.silenceDetector.handleSpeechEnd(result, durationMs);
    });
  }

  private bindSilenceEvents(): void {
    this.silenceDetector.on('significant_pause_detected', (pauseDurationMs) => {
      this.emit('significant_pause', pauseDurationMs);
    });

    this.silenceDetector.on('utterance_end_detected', () => {
      void this.finalizeUtterance('silence-timeout');
    });
  }

  private handleExternalVadDecision(decision: SpeechVadDecision): void {
    const result = decision.result ?? this.createSyntheticVadResult(decision);
    if (decision.isSpeech) {
      if (!this.lastExternalVadSpeech) {
        this.currentSpeechStartedAt = Date.now();
        this.changeState('capturing');
        this.emit('speech_started', {
          timestamp: this.currentSpeechStartedAt,
          vad: result,
        });
        this.silenceDetector.handleSpeechStart(result);
      }
      this.silenceDetector.handleVoiceActivity(result);
      return;
    }

    if (this.lastExternalVadSpeech) {
      const durationMs = this.currentSpeechStartedAt
        ? Date.now() - this.currentSpeechStartedAt
        : this.config.frameDurationMs;
      this.emit('speech_ended', {
        timestamp: Date.now(),
        vad: result,
        durationMs,
      });
      this.silenceDetector.handleSpeechEnd(result, durationMs);
      return;
    }

    this.silenceDetector.handleNoVoiceActivity(result);
  }

  private async finalizeUtterance(reason: SpeechSessionBoundaryReason): Promise<void> {
    if (this.transcriptionPromise) {
      await this.transcriptionPromise;
      return;
    }
    if (this.capturedFrames.length === 0) {
      this.changeState(this.config.mode === 'wake-word' ? 'wake-listening' : 'listening');
      return;
    }

    const audioBuffer = encodeFloat32ToWav(this.capturedFrames, this.config.sampleRate);
    const capture = this.createCapture(audioBuffer);
    this.emit('utterance_captured', { reason, capture });
    this.resetBuffers();

    if (!this.config.autoTranscribeOnSpeechEnd || !this.providers.stt) {
      this.changeState(this.config.mode === 'wake-word' ? 'wake-listening' : 'listening');
      return;
    }

    this.transcriptionPromise = this.transcribeAudio(audioBuffer, {}, capture).finally(() => {
      this.transcriptionPromise = null;
    });
    await this.transcriptionPromise;
  }

  private createCapture(audioBuffer: Buffer): SpeechSessionAudioCapture {
    const bufferedSampleCount = this.capturedFrames.reduce((sum, frame) => sum + frame.length, 0);
    const wavPayloadBytes = Math.max(0, audioBuffer.length - 44);
    const derivedSampleCount = bufferedSampleCount > 0 ? bufferedSampleCount : wavPayloadBytes / 2;
    const durationMs = (derivedSampleCount / this.config.sampleRate) * 1000;

    return {
      audioBuffer,
      mimeType: 'audio/wav',
      fileName: this.config.audioFileName,
      sampleRate: this.config.sampleRate,
      durationMs,
      frameCount: this.capturedFrames.length,
    };
  }

  private resetBuffers(): void {
    this.capturedFrames.length = 0;
    this.currentSpeechStartedAt = null;
    this.lastExternalVadSpeech = false;
    this.vad.resetState();
    this.silenceDetector.reset();
    this.providers.vad?.reset();
    this.providers.wakeWord?.reset?.();
  }

  private createSyntheticVadResult(decision: SpeechVadDecision): VADResult {
    return {
      isSpeech: decision.isSpeech,
      frameEnergy: decision.isSpeech ? 1 : 0,
      currentSpeechThreshold: 0,
      currentSilenceThreshold: 0,
      confidence: decision.confidence,
    };
  }

  private changeState(next: SpeechSessionState): void {
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;
    this.emit('state_changed', { previous, current: next });
  }

  private handleError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.changeState('error');
    this.emit('error', { error: normalized });
  }
}
