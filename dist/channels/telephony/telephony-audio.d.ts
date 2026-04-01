/**
 * @fileoverview Telephony audio utilities.
 *
 * Phone networks use mu-law encoding at 8kHz mono. This module provides
 * conversion utilities for bridging between PCM audio (from TTS providers)
 * and the mu-law format required by telephony media streams.
 *
 * @module @framers/agentos/voice/telephony-audio
 */
/**
 * Convert PCM audio buffer to mu-law 8kHz mono format for telephony.
 *
 * @param pcmBuffer - Raw PCM audio data (signed 16-bit little-endian).
 * @param sampleRate - Sample rate of the input PCM data.
 * @returns Buffer of mu-law encoded audio at 8kHz mono.
 *
 * @example
 * ```typescript
 * // TTS returns 24kHz PCM
 * const ttsAudio = await ttsProvider.synthesize("Hello");
 * const phoneAudio = convertPcmToMulaw8k(ttsAudio, 24000);
 * mediaStream.sendAudio(streamSid, phoneAudio);
 * ```
 */
export declare function convertPcmToMulaw8k(pcmBuffer: Buffer, sampleRate: number): Buffer;
/**
 * Convert mu-law 8kHz audio to PCM signed 16-bit LE.
 *
 * @param mulawBuffer - Mu-law encoded audio data.
 * @returns Buffer of PCM signed 16-bit little-endian audio.
 */
export declare function convertMulawToPcm16(mulawBuffer: Buffer): Buffer;
/**
 * Escape XML special characters for TwiML/VoiceXML generation.
 */
export declare function escapeXml(text: string): string;
/**
 * Validate an E.164 phone number format.
 * @returns The normalized number, or null if invalid.
 */
export declare function validateE164(number: string): string | null;
//# sourceMappingURL=telephony-audio.d.ts.map