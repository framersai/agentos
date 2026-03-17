/**
 * Barrel exports for the AgentOS voice call system.
 *
 * @module @framers/agentos/voice
 */

export * from './types.js';
export type {
  IVoiceCallProvider,
  InitiateCallInput,
  InitiateCallResult,
  HangupCallInput,
  PlayTtsInput,
  StartListeningInput,
  StopListeningInput,
} from './IVoiceCallProvider.js';
export { CallManager } from './CallManager.js';
export type {
  CallManagerEventType,
  CallManagerEvent,
  CallManagerEventHandler,
} from './CallManager.js';
export {
  convertPcmToMulaw8k,
  convertMulawToPcm16,
  escapeXml,
  validateE164,
} from './telephony-audio.js';
