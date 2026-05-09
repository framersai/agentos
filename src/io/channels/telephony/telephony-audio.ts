/**
 * @fileoverview Telephony audio utilities.
 *
 * Phone networks use mu-law encoding at 8kHz mono. This module provides
 * conversion utilities for bridging between PCM audio (from TTS providers)
 * and the mu-law format required by telephony media streams.
 *
 * @module @framers/agentos/voice/telephony-audio
 */

// ============================================================================
// Mu-law Encoding Table
// ============================================================================

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

/** Pre-computed linear-to-mu-law compression table for fast encoding. */
const encodeTable = new Uint8Array(65536);

function buildEncodeTable(): void {
  for (let i = 0; i < 65536; i++) {
    // Convert unsigned 16-bit to signed
    let sample = i < 32768 ? i : i - 65536;

    // Determine sign
    const sign = sample < 0 ? 0x80 : 0;
    if (sample < 0) sample = -sample;

    // Clip
    if (sample > MULAW_CLIP) sample = MULAW_CLIP;
    sample += MULAW_BIAS;

    // Find segment
    let exponent = 7;
    let mask = 0x4000;
    while (!(sample & mask) && exponent > 0) {
      exponent--;
      mask >>= 1;
    }

    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    const muLawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
    encodeTable[i] = muLawByte;
  }
}

buildEncodeTable();

// ============================================================================
// PCM to Mu-law Conversion
// ============================================================================

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
export function convertPcmToMulaw8k(pcmBuffer: Buffer, sampleRate: number): Buffer {
  // Step 1: Resample to 8kHz if needed
  const resampled = sampleRate !== 8000
    ? resamplePcm16(pcmBuffer, sampleRate, 8000)
    : pcmBuffer;

  // Step 2: Encode to mu-law
  const numSamples = resampled.length / 2; // 16-bit samples
  const output = Buffer.alloc(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const sample = resampled.readInt16LE(i * 2);
    // Convert signed to unsigned index for table lookup
    const unsignedSample = sample < 0 ? sample + 65536 : sample;
    output[i] = encodeTable[unsignedSample];
  }

  return output;
}

/**
 * Convert mu-law 8kHz audio to PCM signed 16-bit LE.
 *
 * @param mulawBuffer - Mu-law encoded audio data.
 * @returns Buffer of PCM signed 16-bit little-endian audio.
 */
export function convertMulawToPcm16(mulawBuffer: Buffer): Buffer {
  const output = Buffer.alloc(mulawBuffer.length * 2);

  for (let i = 0; i < mulawBuffer.length; i++) {
    const muLaw = mulawBuffer[i];
    const sample = decodeMulawSample(muLaw);
    output.writeInt16LE(sample, i * 2);
  }

  return output;
}

// ============================================================================
// Resampling
// ============================================================================

/**
 * Simple linear-interpolation resampler for 16-bit PCM audio.
 * Not studio quality, but sufficient for voice telephony.
 */
function resamplePcm16(input: Buffer, fromRate: number, toRate: number): Buffer {
  const numInputSamples = input.length / 2;
  const ratio = fromRate / toRate;
  const numOutputSamples = Math.floor(numInputSamples / ratio);
  const output = Buffer.alloc(numOutputSamples * 2);

  for (let i = 0; i < numOutputSamples; i++) {
    const srcIndex = i * ratio;
    const srcFloor = Math.floor(srcIndex);
    const srcCeil = Math.min(srcFloor + 1, numInputSamples - 1);
    const frac = srcIndex - srcFloor;

    const s0 = input.readInt16LE(srcFloor * 2);
    const s1 = input.readInt16LE(srcCeil * 2);
    const sample = Math.round(s0 + (s1 - s0) * frac);

    output.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }

  return output;
}

// ============================================================================
// Mu-law Decode
// ============================================================================

/** Decode a single mu-law byte to a signed 16-bit PCM sample. */
function decodeMulawSample(muLaw: number): number {
  const complement = ~muLaw & 0xff;
  const sign = complement & 0x80;
  const exponent = (complement >> 4) & 0x07;
  const mantissa = complement & 0x0f;

  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;

  return sign ? -sample : sample;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Escape XML special characters for TwiML/VoiceXML generation.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Validate an E.164 phone number format.
 * @returns The normalized number, or null if invalid.
 */
export function validateE164(number: string): string | null {
  const normalized = number.replace(/[\s\-()]/g, '');
  return /^\+[1-9]\d{1,14}$/.test(normalized) ? normalized : null;
}
