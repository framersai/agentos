/**
 * Barrel exports for the AgentOS streaming voice pipeline.
 *
 * @module @framers/agentos/voice-pipeline
 */

export * from './types.js';
export { HardCutBargeinHandler } from './HardCutBargeinHandler.js';
export { SoftFadeBargeinHandler } from './SoftFadeBargeinHandler.js';
export { HeuristicEndpointDetector } from './HeuristicEndpointDetector.js';
export { AcousticEndpointDetector } from './AcousticEndpointDetector.js';
export { WebSocketStreamTransport } from './WebSocketStreamTransport.js';
export { VoicePipelineOrchestrator } from './VoicePipelineOrchestrator.js';
