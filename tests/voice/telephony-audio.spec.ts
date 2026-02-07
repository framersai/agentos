import { describe, it, expect } from 'vitest';
import {
  convertPcmToMulaw8k,
  convertMulawToPcm16,
  escapeXml,
  validateE164,
} from '../../src/voice/telephony-audio';

// ============================================================================
// convertPcmToMulaw8k
// ============================================================================

describe('convertPcmToMulaw8k', () => {
  it('produces output of the correct length for 8kHz input (no resampling)', () => {
    // 100 samples at 16-bit = 200 bytes
    const pcm = Buffer.alloc(200);
    for (let i = 0; i < 100; i++) {
      pcm.writeInt16LE(Math.round(Math.sin(i / 10) * 10000), i * 2);
    }

    const mulaw = convertPcmToMulaw8k(pcm, 8000);

    // mu-law is 1 byte per sample, so 100 samples => 100 bytes
    expect(mulaw.length).toBe(100);
  });

  it('downsamples from higher sample rates (24kHz -> 8kHz)', () => {
    // 240 samples at 24kHz = 10ms of audio
    const numInputSamples = 240;
    const pcm = Buffer.alloc(numInputSamples * 2);
    for (let i = 0; i < numInputSamples; i++) {
      pcm.writeInt16LE(Math.round(Math.sin(i / 30) * 8000), i * 2);
    }

    const mulaw = convertPcmToMulaw8k(pcm, 24000);

    // 240 samples at 24kHz downsampled to 8kHz = 80 samples
    // mu-law is 1 byte per sample
    expect(mulaw.length).toBe(Math.floor(numInputSamples / 3));
  });

  it('downsamples from 16kHz to 8kHz', () => {
    const numInputSamples = 160; // 10ms at 16kHz
    const pcm = Buffer.alloc(numInputSamples * 2);
    for (let i = 0; i < numInputSamples; i++) {
      pcm.writeInt16LE(0, i * 2);
    }

    const mulaw = convertPcmToMulaw8k(pcm, 16000);

    // 160 at 16kHz -> 80 at 8kHz
    expect(mulaw.length).toBe(80);
  });

  it('produces values in valid mu-law range (0-255)', () => {
    const pcm = Buffer.alloc(200);
    for (let i = 0; i < 100; i++) {
      // Use a variety of values including extremes
      const val = i < 50 ? (i * 650) : -(i * 650);
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, val)), i * 2);
    }

    const mulaw = convertPcmToMulaw8k(pcm, 8000);

    for (let i = 0; i < mulaw.length; i++) {
      expect(mulaw[i]).toBeGreaterThanOrEqual(0);
      expect(mulaw[i]).toBeLessThanOrEqual(255);
    }
  });

  it('encodes silence (zero samples) consistently', () => {
    const pcm = Buffer.alloc(20); // 10 zero-valued samples
    const mulaw = convertPcmToMulaw8k(pcm, 8000);

    // All samples should encode to the same mu-law value for silence
    const silenceValue = mulaw[0];
    for (let i = 1; i < mulaw.length; i++) {
      expect(mulaw[i]).toBe(silenceValue);
    }
  });

  it('encodes positive maximum (32767) without error', () => {
    const pcm = Buffer.alloc(2);
    pcm.writeInt16LE(32767, 0);

    const mulaw = convertPcmToMulaw8k(pcm, 8000);
    expect(mulaw.length).toBe(1);
    expect(mulaw[0]).toBeGreaterThanOrEqual(0);
    expect(mulaw[0]).toBeLessThanOrEqual(255);
  });

  it('encodes negative maximum (-32768) without error', () => {
    const pcm = Buffer.alloc(2);
    pcm.writeInt16LE(-32768, 0);

    const mulaw = convertPcmToMulaw8k(pcm, 8000);
    expect(mulaw.length).toBe(1);
    expect(mulaw[0]).toBeGreaterThanOrEqual(0);
    expect(mulaw[0]).toBeLessThanOrEqual(255);
  });
});

// ============================================================================
// convertMulawToPcm16
// ============================================================================

describe('convertMulawToPcm16', () => {
  it('produces output that is double the input length (16-bit PCM)', () => {
    const mulaw = Buffer.from([0x00, 0x7f, 0x80, 0xff]);
    const pcm = convertMulawToPcm16(mulaw);
    expect(pcm.length).toBe(mulaw.length * 2);
  });

  it('decodes to signed 16-bit values within range', () => {
    // Test all 256 possible mu-law values
    const mulaw = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) {
      mulaw[i] = i;
    }

    const pcm = convertMulawToPcm16(mulaw);

    for (let i = 0; i < 256; i++) {
      const sample = pcm.readInt16LE(i * 2);
      expect(sample).toBeGreaterThanOrEqual(-32768);
      expect(sample).toBeLessThanOrEqual(32767);
    }
  });

  it('round-trip encoding preserves signal shape', () => {
    // Create a simple sine wave at 8kHz
    const numSamples = 80; // 10ms
    const originalPcm = Buffer.alloc(numSamples * 2);
    for (let i = 0; i < numSamples; i++) {
      const sample = Math.round(Math.sin((2 * Math.PI * i) / 20) * 8000);
      originalPcm.writeInt16LE(sample, i * 2);
    }

    // Encode to mu-law and back
    const mulaw = convertPcmToMulaw8k(originalPcm, 8000);
    const reconstructed = convertMulawToPcm16(mulaw);

    expect(reconstructed.length).toBe(originalPcm.length);

    // Mu-law is lossy, but the reconstructed signal should be close
    // Check that SNR is reasonable: error should be small relative to signal
    let maxError = 0;
    for (let i = 0; i < numSamples; i++) {
      const orig = originalPcm.readInt16LE(i * 2);
      const recon = reconstructed.readInt16LE(i * 2);
      maxError = Math.max(maxError, Math.abs(orig - recon));
    }

    // Mu-law quantization error for mid-range samples should be within ~2%
    // of the dynamic range (65536). 2% = 1310.
    expect(maxError).toBeLessThan(1500);
  });

  it('decodes silence mu-law to near-zero PCM', () => {
    // Silence in PCM -> mu-law -> back should be near zero
    const silentPcm = Buffer.alloc(20); // 10 zero samples
    const mulaw = convertPcmToMulaw8k(silentPcm, 8000);
    const decoded = convertMulawToPcm16(mulaw);

    for (let i = 0; i < 10; i++) {
      const sample = decoded.readInt16LE(i * 2);
      // Mu-law bias means silence doesn't decode to exactly zero, but it should be very small
      expect(Math.abs(sample)).toBeLessThan(200);
    }
  });

  it('handles single-byte input', () => {
    const mulaw = Buffer.from([0x80]); // single sample
    const pcm = convertMulawToPcm16(mulaw);
    expect(pcm.length).toBe(2);
  });

  it('handles empty input', () => {
    const mulaw = Buffer.alloc(0);
    const pcm = convertMulawToPcm16(mulaw);
    expect(pcm.length).toBe(0);
  });
});

// ============================================================================
// escapeXml
// ============================================================================

describe('escapeXml', () => {
  it('escapes ampersand', () => {
    expect(escapeXml('A & B')).toBe('A &amp; B');
  });

  it('escapes less-than', () => {
    expect(escapeXml('a < b')).toBe('a &lt; b');
  });

  it('escapes greater-than', () => {
    expect(escapeXml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quote', () => {
    expect(escapeXml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('escapes single quote (apostrophe)', () => {
    expect(escapeXml("it's")).toBe('it&apos;s');
  });

  it('escapes all special characters in a single string', () => {
    expect(escapeXml('<tag attr="val" other=\'val2\'> & </tag>')).toBe(
      '&lt;tag attr=&quot;val&quot; other=&apos;val2&apos;&gt; &amp; &lt;/tag&gt;',
    );
  });

  it('returns the same string when no special characters are present', () => {
    expect(escapeXml('Hello World 123')).toBe('Hello World 123');
  });

  it('handles empty string', () => {
    expect(escapeXml('')).toBe('');
  });

  it('handles multiple consecutive special characters', () => {
    expect(escapeXml('<<>>')).toBe('&lt;&lt;&gt;&gt;');
  });

  it('escapes ampersand before other entities (no double-escape on single pass)', () => {
    // The function replaces & first, so &lt; in original text becomes &amp;lt;
    expect(escapeXml('&lt;')).toBe('&amp;lt;');
  });
});

// ============================================================================
// validateE164
// ============================================================================

describe('validateE164', () => {
  it('accepts a valid US number', () => {
    expect(validateE164('+15551234567')).toBe('+15551234567');
  });

  it('accepts a valid UK number', () => {
    expect(validateE164('+442071234567')).toBe('+442071234567');
  });

  it('accepts a short valid number (minimum length)', () => {
    // Minimum: +X (1 digit country code) + 1 digit = +XY -> 2 digits total
    expect(validateE164('+12')).toBe('+12');
  });

  it('accepts maximum length E.164 number (15 digits)', () => {
    expect(validateE164('+123456789012345')).toBe('+123456789012345');
  });

  it('strips spaces and returns normalized number', () => {
    expect(validateE164('+1 555 123 4567')).toBe('+15551234567');
  });

  it('strips dashes and returns normalized number', () => {
    expect(validateE164('+1-555-123-4567')).toBe('+15551234567');
  });

  it('strips parentheses and returns normalized number', () => {
    expect(validateE164('+1(555)1234567')).toBe('+15551234567');
  });

  it('strips mixed formatting characters', () => {
    expect(validateE164('+1 (555) 123-4567')).toBe('+15551234567');
  });

  it('rejects number without leading +', () => {
    expect(validateE164('15551234567')).toBeNull();
  });

  it('rejects number starting with +0', () => {
    expect(validateE164('+05551234567')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateE164('')).toBeNull();
  });

  it('rejects just a plus sign', () => {
    expect(validateE164('+')).toBeNull();
  });

  it('rejects number with letters', () => {
    expect(validateE164('+1555ABCDEFG')).toBeNull();
  });

  it('rejects number that exceeds 15 digits', () => {
    expect(validateE164('+1234567890123456')).toBeNull();
  });

  it('rejects number with only one digit after +', () => {
    // +X where X is 1-9 is valid per the regex (1-14 more digits after first)
    // Actually +1 is just +[1-9] with \d{1,14} needing at least 1 more digit
    // So +1 alone should match: +[1-9]\d{1,14} -> + 1 \d{1,14} where \d{1,14} needs 1 digit min
    // Wait: the regex is /^\+[1-9]\d{1,14}$/ — that means +[first digit 1-9] followed by 1 to 14 more digits
    // So minimum is 2 digits total (e.g., "+12") and "+1" alone (1 digit after +) does NOT match
    expect(validateE164('+1')).toBeNull();
  });
});
