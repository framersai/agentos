/**
 * Barrel exports for the AgentOS voice call system.
 *
 * @module @framers/agentos/telephony
 */
export * from './types.js';
export { CallManager } from './CallManager.js';
export { convertPcmToMulaw8k, convertMulawToPcm16, escapeXml, validateE164, } from './telephony-audio.js';
export { TwilioMediaStreamParser } from './parsers/TwilioMediaStreamParser.js';
export { TelnyxMediaStreamParser } from './parsers/TelnyxMediaStreamParser.js';
export { PlivoMediaStreamParser } from './parsers/PlivoMediaStreamParser.js';
// ── Telephony stream transport ────────────────────────────────────────────────
export { TelephonyStreamTransport } from './TelephonyStreamTransport.js';
// ── Voice call providers ──────────────────────────────────────────────────────
export { TwilioVoiceProvider } from './providers/twilio.js';
export { TelnyxVoiceProvider } from './providers/telnyx.js';
export { PlivoVoiceProvider } from './providers/plivo.js';
// ── TwiML / XML helpers ───────────────────────────────────────────────────────
export { twilioConversationTwiml, twilioNotifyTwiml, telnyxStreamXml, plivoStreamXml, plivoNotifyXml, } from './twiml.js';
//# sourceMappingURL=index.js.map