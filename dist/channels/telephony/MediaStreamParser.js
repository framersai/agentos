/**
 * @fileoverview Interface for parsing provider-specific WebSocket media stream messages.
 *
 * Each telephony provider (Twilio, Telnyx, Plivo, etc.) sends audio data
 * over WebSocket in its own proprietary JSON or binary format. Implementations
 * of this interface normalise the provider wire format into the shared
 * {@link MediaStreamIncoming} discriminated union so the rest of the voice
 * pipeline never needs to know which provider is in use.
 *
 * ## Implementing a custom parser
 *
 * @example
 * ```typescript
 * import type { MediaStreamParser, MediaStreamIncoming } from './MediaStreamParser.js';
 *
 * class CustomMediaStreamParser implements MediaStreamParser {
 *   parseIncoming(data: Buffer | string): MediaStreamIncoming | null {
 *     const msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
 *     if (msg.type === 'audio') {
 *       return {
 *         type: 'audio',
 *         payload: Buffer.from(msg.audioData, 'base64'),
 *         streamSid: msg.sessionId,
 *       };
 *     }
 *     return null; // Silently ignore unknown message types
 *   }
 *
 *   formatOutgoing(audio: Buffer, streamSid: string): Buffer | string {
 *     return JSON.stringify({
 *       type: 'playback',
 *       sessionId: streamSid,
 *       audioData: audio.toString('base64'),
 *     });
 *   }
 *
 *   formatConnected(streamSid: string): string | null {
 *     return JSON.stringify({ type: 'ready', sessionId: streamSid });
 *   }
 * }
 * ```
 *
 * @module @framers/agentos/voice/MediaStreamParser
 */
export {};
//# sourceMappingURL=MediaStreamParser.js.map