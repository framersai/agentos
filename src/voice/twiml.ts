/**
 * @fileoverview TwiML and XML generation helpers for telephony providers.
 *
 * Generates provider-specific XML/TwiML response payloads for Twilio, Telnyx,
 * and Plivo. All text content and attribute values are XML-escaped to prevent
 * injection or malformed markup.
 *
 * @module @framers/agentos/voice/twiml
 */

import { escapeXml } from './telephony-audio.js';

// ============================================================================
// Twilio TwiML
// ============================================================================

/**
 * Generate TwiML for Twilio conversation mode using a bidirectional media stream.
 *
 * The returned markup instructs Twilio to open a WebSocket to `streamUrl` and
 * stream audio in both directions for the duration of the call.
 *
 * @param streamUrl - WebSocket URL Twilio should connect to (e.g. `wss://…/stream`).
 * @param token - Optional bearer token appended as a `?token=` query parameter.
 * @returns A complete TwiML XML document string.
 *
 * @example
 * ```typescript
 * res.type('text/xml').send(twilioConversationTwiml('wss://api.example.com/call', jwtToken));
 * ```
 */
export function twilioConversationTwiml(streamUrl: string, token?: string): string {
  const url = token ? `${streamUrl}?token=${token}` : streamUrl;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Connect><Stream url="${escapeXml(url)}" /></Connect></Response>`;
}

/**
 * Generate TwiML for Twilio notify mode — synthesise `text` over the call then hang up.
 *
 * Useful for delivering one-shot announcements (e.g. voicemail greetings, error
 * messages) without establishing a full media stream.
 *
 * @param text - The message to speak to the caller.
 * @param voice - Optional Twilio voice name (e.g. `'Polly.Joanna'`, `'alice'`).
 * @returns A complete TwiML XML document string.
 */
export function twilioNotifyTwiml(text: string, voice?: string): string {
  const voiceAttr = voice ? ` voice="${escapeXml(voice)}"` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say${voiceAttr}>${escapeXml(text)}</Say><Hangup/></Response>`;
}

// ============================================================================
// Telnyx XML
// ============================================================================

/**
 * Generate a Telnyx streaming XML response.
 *
 * Telnyx primarily uses a REST API for call control, but this helper produces
 * an XML acknowledgment document wrapping the stream URL for webhook responses
 * that require XML.
 *
 * @param streamUrl - WebSocket URL Telnyx should stream audio to.
 * @returns A complete XML document string.
 */
export function telnyxStreamXml(streamUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Stream url="${escapeXml(streamUrl)}" /></Response>`;
}

// ============================================================================
// Plivo XML
// ============================================================================

/**
 * Generate Plivo bidirectional streaming XML.
 *
 * Instructs Plivo to open a bidirectional WebSocket stream and keep the call
 * alive for the duration of the stream session.
 *
 * @param streamUrl - WebSocket URL Plivo should connect to.
 * @returns A complete Plivo XML document string.
 */
export function plivoStreamXml(streamUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Stream bidirectional="true" keepCallAlive="true">${escapeXml(streamUrl)}</Stream></Response>`;
}

/**
 * Generate Plivo speak + hangup XML.
 *
 * Synthesises `text` to the caller using Plivo's TTS engine and immediately
 * hangs up after playback completes.
 *
 * @param text - The message to speak to the caller.
 * @param voice - Optional Plivo voice name (e.g. `'WOMAN'`, `'Polly.Joanna'`).
 * @returns A complete Plivo XML document string.
 */
export function plivoNotifyXml(text: string, voice?: string): string {
  const voiceAttr = voice ? ` voice="${escapeXml(voice)}"` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Speak${voiceAttr}>${escapeXml(text)}</Speak><Hangup/></Response>`;
}
