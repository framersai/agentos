/**
 * @module voice-pipeline/providers
 *
 * Concrete provider implementations for the voice pipeline:
 * - {@link DeepgramStreamingSTT} — Deepgram WebSocket streaming STT
 * - {@link ElevenLabsStreamingTTS} — ElevenLabs WebSocket streaming TTS
 * - {@link AgentSessionVoiceAdapter} — AgentOS session → voice pipeline adapter
 * - {@link OpenAIBatchTTS} — OpenAI batch (one-shot) TTS
 * - {@link ElevenLabsBatchTTS} — ElevenLabs batch (one-shot) TTS
 */

export { DeepgramStreamingSTT, type DeepgramStreamingSTTConfig } from './DeepgramStreamingSTT.js';
export {
  ElevenLabsStreamingSTT,
  type ElevenLabsStreamingSTTConfig,
} from './ElevenLabsStreamingSTT.js';
export {
  ElevenLabsStreamingTTS,
  type ElevenLabsStreamingTTSConfig,
} from './ElevenLabsStreamingTTS.js';
export { AgentSessionVoiceAdapter } from './AgentSessionVoiceAdapter.js';
export { OpenAIBatchTTS, type OpenAIBatchTTSConfig } from './OpenAIBatchTTS.js';
export { ElevenLabsBatchTTS, type ElevenLabsBatchTTSConfig } from './ElevenLabsBatchTTS.js';
