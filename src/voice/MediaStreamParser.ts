/**
 * Interface for parsing provider-specific WebSocket media stream messages.
 *
 * Each telephony provider (Twilio, Telnyx, Plivo, etc.) sends audio data
 * over WebSocket in its own proprietary JSON or binary format. Implementations
 * of this interface normalise the provider wire format into the shared
 * {@link MediaStreamIncoming} discriminated union so the rest of the voice
 * pipeline never needs to know which provider is in use.
 */
export interface MediaStreamParser {
  /**
   * Parse a raw WebSocket message received from the telephony provider.
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
   * @param streamSid - The stream identifier established during the handshake.
   * @returns A JSON string to send as the first WS message, or `null` if the
   *   provider does not need an explicit acknowledgment.
   */
  formatConnected?(streamSid: string): string | null;
}

/**
 * Discriminated union of all normalised events that can arrive on a media
 * stream WebSocket connection, regardless of the underlying telephony provider.
 */
export type MediaStreamIncoming =
  | {
      /** Inbound audio chunk encoded as mu-law 8-bit 8 kHz PCM. */
      type: 'audio';
      /** Raw mu-law bytes decoded from whatever encoding the provider uses. */
      payload: Buffer;
      /** Provider-assigned stream identifier. */
      streamSid: string;
      /** Monotonically increasing sequence number, when provided. */
      sequenceNumber?: number;
    }
  | {
      /** DTMF tone detected by the provider during the call. */
      type: 'dtmf';
      /** Single character digit pressed by the caller (0-9, *, #, A-D). */
      digit: string;
      /** Provider-assigned stream identifier. */
      streamSid: string;
      /** Duration the key was held, in milliseconds, when reported. */
      durationMs?: number;
    }
  | {
      /** Stream successfully started; metadata about the call is available. */
      type: 'start';
      /** Provider-assigned stream identifier. */
      streamSid: string;
      /** Provider call-leg identifier (e.g. Twilio CallSid, Telnyx call_control_id). */
      callSid: string;
      /** Additional provider-specific metadata attached to the start event. */
      metadata?: Record<string, unknown>;
    }
  | {
      /** Call ended or stream was explicitly stopped. */
      type: 'stop';
      /** Provider-assigned stream identifier. */
      streamSid: string;
    }
  | {
      /** Named marker injected into the audio stream for synchronisation. */
      type: 'mark';
      /** The label assigned to this mark point. */
      name: string;
      /** Provider-assigned stream identifier. */
      streamSid: string;
    };
