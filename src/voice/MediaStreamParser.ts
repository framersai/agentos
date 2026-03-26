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

/**
 * Contract for parsing and formatting provider-specific WebSocket media
 * stream messages.
 *
 * The interface has three responsibilities:
 *
 * 1. **Inbound normalisation** ({@link parseIncoming}) -- Convert the provider's
 *    proprietary wire format into {@link MediaStreamIncoming} events.
 * 2. **Outbound formatting** ({@link formatOutgoing}) -- Wrap mu-law audio
 *    bytes in whatever envelope the provider expects.
 * 3. **Connection handshake** ({@link formatConnected}) -- Optionally generate
 *    a first-message acknowledgment required by some providers (e.g., Twilio).
 *
 * @see TwilioMediaStreamParser -- JSON envelope, base64 audio, `connected` ack.
 * @see TelnyxMediaStreamParser -- JSON inbound, raw binary outbound, no ack.
 * @see PlivoMediaStreamParser  -- JSON envelope, `playAudio` outbound, no ack.
 */
export interface MediaStreamParser {
  /**
   * Parse a raw WebSocket message received from the telephony provider.
   *
   * Implementations must handle both `Buffer` (binary frames) and `string`
   * (text frames) inputs, since different providers and WebSocket libraries
   * deliver data in different forms.
   *
   * @param data - Raw message bytes or string as delivered by the WS frame.
   * @returns A normalised {@link MediaStreamIncoming} event, or `null` if the
   *   message should be silently ignored (e.g. unknown event type, outbound
   *   audio track, heartbeat frames, etc.).
   */
  parseIncoming(data: Buffer | string): MediaStreamIncoming | null;

  /**
   * Encode mu-law audio for transmission back to the telephony provider.
   *
   * The returned type varies by provider:
   * - **Twilio**: Returns a JSON `string` wrapping base64-encoded audio in a
   *   `{ event: 'media', streamSid, media: { payload } }` envelope.
   * - **Telnyx**: Returns the raw `Buffer` unchanged (binary WS frame).
   * - **Plivo**: Returns a JSON `string` with a `{ event: 'playAudio', media: { payload } }` envelope.
   *
   * @param audio - Raw mu-law PCM bytes to send to the caller.
   * @param streamSid - Provider stream identifier required by some formats.
   * @returns A `Buffer` (for providers that accept raw binary) or a JSON
   *   `string` (for providers that wrap audio in an envelope).
   */
  formatOutgoing(audio: Buffer, streamSid: string): Buffer | string;

  /**
   * Generate the initial connection acknowledgment message, if the provider
   * requires one immediately after the WebSocket handshake.
   *
   * - **Twilio**: Returns `{ event: 'connected', protocol: 'Call', version: '1.0.0' }`.
   * - **Telnyx**: Returns `null` (no handshake needed).
   * - **Plivo**: Not defined (no handshake needed).
   *
   * @param streamSid - The stream identifier established during the handshake.
   * @returns A JSON string to send as the first WS message, or `null` if the
   *   provider does not need an explicit acknowledgment.
   */
  formatConnected?(streamSid: string): string | null;
}

/**
 * Discriminated union of all normalised events that can arrive on a media
 * stream WebSocket connection, regardless of the underlying telephony provider.
 *
 * ## Variant summary
 *
 * | `type`   | When it fires                                | Key payload fields          |
 * |----------|----------------------------------------------|-----------------------------|
 * | `audio`  | Each inbound audio chunk (~20ms intervals)   | `payload` (mu-law Buffer)   |
 * | `dtmf`   | Caller presses a phone keypad button         | `digit`, `durationMs?`      |
 * | `start`  | Stream session begins (metadata available)   | `callSid`, `metadata?`      |
 * | `stop`   | Stream session ends / call disconnects       | (none beyond `streamSid`)   |
 * | `mark`   | Named sync point injected into audio stream  | `name`                      |
 *
 * All variants carry a `streamSid` field to identify which stream the event
 * belongs to (important when a single server handles multiple concurrent calls).
 */
export type MediaStreamIncoming =
  | {
      /**
       * Inbound audio chunk encoded as mu-law 8-bit 8 kHz PCM.
       *
       * Audio arrives as small chunks (typically 20ms / 160 bytes) at regular
       * intervals for the duration of the call. The pipeline must decode
       * mu-law -> PCM Int16 -> resample -> Float32 before feeding to STT/VAD.
       */
      type: 'audio';
      /** Raw mu-law bytes decoded from whatever encoding the provider uses. */
      payload: Buffer;
      /** Provider-assigned stream identifier. */
      streamSid: string;
      /** Monotonically increasing sequence number, when provided. */
      sequenceNumber?: number;
    }
  | {
      /**
       * DTMF tone detected by the provider during the call.
       *
       * Not all providers relay DTMF over the media stream -- Telnyx, for
       * example, only delivers DTMF via HTTP webhooks. Check the provider's
       * parser documentation for availability.
       */
      type: 'dtmf';
      /** Single character digit pressed by the caller (0-9, *, #, A-D). */
      digit: string;
      /** Provider-assigned stream identifier. */
      streamSid: string;
      /** Duration the key was held, in milliseconds, when reported. */
      durationMs?: number;
    }
  | {
      /**
       * Stream successfully started; metadata about the call is available.
       *
       * This is always the first meaningful event on a new stream connection.
       * The {@link TelephonyStreamTransport} transitions from `connecting` to
       * `open` upon receiving this event and sends the optional
       * {@link MediaStreamParser.formatConnected} acknowledgment.
       */
      type: 'start';
      /** Provider-assigned stream identifier. */
      streamSid: string;
      /** Provider call-leg identifier (e.g. Twilio CallSid, Telnyx call_control_id). */
      callSid: string;
      /** Additional provider-specific metadata attached to the start event. */
      metadata?: Record<string, unknown>;
    }
  | {
      /**
       * Call ended or stream was explicitly stopped.
       *
       * The {@link TelephonyStreamTransport} transitions to `closed` and
       * emits a `'close'` event upon receiving this.
       */
      type: 'stop';
      /** Provider-assigned stream identifier. */
      streamSid: string;
    }
  | {
      /**
       * Named marker injected into the audio stream for synchronisation.
       *
       * Marks are used to correlate outbound audio playback completion with
       * application logic (e.g., knowing when a TTS utterance finished playing
       * so the agent can transition from `speaking` to `listening`).
       */
      type: 'mark';
      /** The label assigned to this mark point. */
      name: string;
      /** Provider-assigned stream identifier. */
      streamSid: string;
    };
