/**
 * @module @framers/agentos/voice-pipeline
 *
 * Real-time streaming voice pipeline for AgentOS.
 *
 * Provides a complete, provider-agnostic voice conversation system with
 * pluggable STT, TTS, endpoint detection, barge-in handling, and transport.
 *
 * ## Architecture
 *
 * ```
 * Browser Mic → Transport → STT → Endpoint Detector → Agent → TTS → Transport → Browser Speaker
 *                                                        ↑
 *                                                  Barge-in Handler
 * ```
 *
 * All components are injected via `VoicePipelineOverrides`, making the pipeline
 * fully provider-agnostic. Swap Deepgram for ElevenLabs STT, or ElevenLabs for
 * OpenAI TTS, by changing one line.
 *
 * ## Built-in Providers
 *
 * **STT (Speech-to-Text):**
 * - {@link DeepgramStreamingSTT} — WebSocket streaming via Deepgram Nova-2. Lowest latency.
 * - {@link ElevenLabsStreamingSTT} — Chunked REST via ElevenLabs Scribe. Uses same key as TTS.
 *
 * **TTS (Text-to-Speech):**
 * - {@link ElevenLabsStreamingTTS} — WebSocket streaming via ElevenLabs. High quality voices.
 *
 * **Endpoint Detection:**
 * - {@link HeuristicEndpointDetector} — Punctuation + silence timeout. Fast, no model needed.
 * - {@link AcousticEndpointDetector} — Silence-only, no transcript analysis.
 *
 * **Barge-in Handling:**
 * - {@link HardCutBargeinHandler} — Immediate TTS cancel above speech threshold.
 * - {@link SoftFadeBargeinHandler} — Three-tier (ignore/pause/cancel) with configurable fade.
 *
 * **Transport:**
 * - {@link WebSocketStreamTransport} — WebSocket bidirectional audio/text.
 * - {@link WebRTCStreamTransport} — WebRTC DataChannel transport.
 *
 * **Agent Adapter:**
 * - {@link AgentSessionVoiceAdapter} — Wraps any AgentOS `AgentSession` as `IVoicePipelineAgentSession`.
 *
 * ## Usage
 *
 * ```typescript
 * import {
 *   VoicePipelineOrchestrator,
 *   HeuristicEndpointDetector,
 *   HardCutBargeinHandler,
 *   WebSocketStreamTransport,
 *   ElevenLabsStreamingSTT,
 *   ElevenLabsStreamingTTS,
 *   AgentSessionVoiceAdapter,
 * } from '../voice-pipeline/index.js';
 * import { agent } from '@framers/agentos';
 *
 * // Create agent and voice adapter
 * const a = agent({ model: 'gpt-4o-mini', instructions: 'You are a voice companion.' });
 * const session = a.session('voice-1');
 * const voiceAdapter = new AgentSessionVoiceAdapter(session);
 *
 * // Create providers (use whichever API keys you have)
 * const stt = new ElevenLabsStreamingSTT({ apiKey: process.env.ELEVENLABS_API_KEY! });
 * const tts = new ElevenLabsStreamingTTS({ apiKey: process.env.ELEVENLABS_API_KEY! });
 *
 * // Create and start the pipeline
 * const orchestrator = new VoicePipelineOrchestrator({
 *   stt: 'elevenlabs', tts: 'elevenlabs', language: 'en-US',
 * });
 *
 * const pipelineSession = await orchestrator.startSession(transport, voiceAdapter, {
 *   streamingSTT: stt,
 *   streamingTTS: tts,
 *   endpointDetector: new HeuristicEndpointDetector(),
 *   bargeinHandler: new HardCutBargeinHandler(),
 * });
 *
 * // Listen for state changes (idle → listening → processing → speaking → listening)
 * pipelineSession.on('state_change', (state) => console.log('Pipeline:', state));
 * ```
 *
 * ## Custom Providers
 *
 * Implement {@link IStreamingSTT} and {@link IStreamingTTS} to add any provider:
 *
 * ```typescript
 * class MyCustomSTT implements IStreamingSTT {
 *   readonly providerId = 'my-custom-stt';
 *   readonly isStreaming = true;
 *   async startSession(config?: StreamingSTTConfig): Promise<StreamingSTTSession> {
 *     // Connect to your STT service, return a session that emits 'transcript' events
 *   }
 * }
 * ```
 */
// Re-export all type definitions from the types module.
// Consumers can import any interface or type alias directly from this barrel.
export * from './types.js';
// Concrete barge-in handler implementations
export { HardCutBargeinHandler } from './HardCutBargeinHandler.js';
export { SoftFadeBargeinHandler } from './SoftFadeBargeinHandler.js';
// Concrete endpoint detector implementations
export { HeuristicEndpointDetector } from './HeuristicEndpointDetector.js';
export { AcousticEndpointDetector } from './AcousticEndpointDetector.js';
// WebSocket-based transport implementation
export { WebSocketStreamTransport } from './WebSocketStreamTransport.js';
// WebRTC DataChannel-based transport implementation
export { WebRTCStreamTransport, createWebRTCTransport } from './WebRTCStreamTransport.js';
// Central pipeline orchestrator (state machine)
export { VoicePipelineOrchestrator } from './VoicePipelineOrchestrator.js';
// Typed error for barge-in interruptions
export { VoiceInterruptError } from './VoiceInterruptError.js';
// Streaming provider implementations
export { DeepgramStreamingSTT, ElevenLabsStreamingSTT, ElevenLabsStreamingTTS, AgentSessionVoiceAdapter, } from './providers/index.js';
//# sourceMappingURL=index.js.map