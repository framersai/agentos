/**
 * @module voice-pipeline/providers
 *
 * Concrete provider implementations for the voice pipeline:
 * - {@link DeepgramStreamingSTT} — Deepgram WebSocket streaming STT
 * - {@link ElevenLabsStreamingTTS} — ElevenLabs WebSocket streaming TTS
 * - {@link AgentSessionVoiceAdapter} — AgentOS session → voice pipeline adapter
 */
export { DeepgramStreamingSTT } from './DeepgramStreamingSTT.js';
export { ElevenLabsStreamingSTT, } from './ElevenLabsStreamingSTT.js';
export { ElevenLabsStreamingTTS, } from './ElevenLabsStreamingTTS.js';
export { AgentSessionVoiceAdapter } from './AgentSessionVoiceAdapter.js';
//# sourceMappingURL=index.js.map