/**
 * Cross-platform base64 helpers for memory import/export.
 *
 * These helpers avoid relying on Node's Buffer in browser builds while still
 * using it when available for performance.
 */

function _toUint8Array(value: ArrayBuffer | ArrayBufferView | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

export function bytesToBase64(value: ArrayBuffer | ArrayBufferView | Uint8Array): string {
  const bytes = _toUint8Array(value);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  const btoaFn = (globalThis as { btoa?: (input: string) => string }).btoa;
  if (!btoaFn) {
    throw new Error('No base64 encoder available in this runtime.');
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoaFn(binary);
}

export function base64ToBytes(encoded: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(encoded, 'base64'));
  }

  const atobFn = (globalThis as { atob?: (input: string) => string }).atob;
  if (!atobFn) {
    throw new Error('No base64 decoder available in this runtime.');
  }

  const binary = atobFn(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function asBinaryBytes(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}
