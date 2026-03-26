/**
 * @module @framers/agentos/voice-pipeline
 *
 * Barrel exports for the AgentOS streaming voice pipeline.
 *
 * This module provides all the building blocks needed to assemble a real-time
 * voice conversation system:
 *
 * - **Types** -- All interfaces and type aliases defining the pipeline's contracts
 *   ({@link AudioFrame}, {@link IStreamTransport}, {@link IEndpointDetector}, etc.).
 *
 * - **Orchestrator** -- {@link VoicePipelineOrchestrator} is the central state machine
 *   that wires transport, STT, endpoint detection, TTS, and barge-in handling into
 *   a coordinated conversation loop.
 *
 * - **Endpoint Detectors** -- Two strategies for detecting turn boundaries:
 *   - {@link HeuristicEndpointDetector}: Rule-based (punctuation + silence timeout).
 *   - {@link AcousticEndpointDetector}: Purely acoustic (silence-only, no transcript analysis).
 *
 * - **Barge-in Handlers** -- Two strategies for handling user interruptions:
 *   - {@link HardCutBargeinHandler}: Immediate stop above a speech duration threshold.
 *   - {@link SoftFadeBargeinHandler}: Three-tier (ignore/pause/cancel) with configurable fade.
 *
 * - **Transport** -- {@link WebSocketStreamTransport}: WebSocket-based bidirectional
 *   audio/text transport implementing {@link IStreamTransport}.
 *
 * - **Error** -- {@link VoiceInterruptError}: Typed error for barge-in interruptions.
 *
 * @example
 * ```typescript
 * import {
 *   VoicePipelineOrchestrator,
 *   HeuristicEndpointDetector,
 *   HardCutBargeinHandler,
 *   WebSocketStreamTransport,
 * } from '@framers/agentos/voice-pipeline';
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

// Central pipeline orchestrator (state machine)
export { VoicePipelineOrchestrator } from './VoicePipelineOrchestrator.js';

// Typed error for barge-in interruptions
export { VoiceInterruptError } from './VoiceInterruptError.js';
