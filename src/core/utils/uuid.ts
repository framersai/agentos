const UUID_TEMPLATE = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';

/**
 * Generate a RFC4122 version 4 UUID using the best source of randomness
 * available in the current runtime (Node, browser, workers, etc.).
 */
export function generateUUID(): string {
  const globalCrypto: any = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;

  if (globalCrypto?.randomUUID) {
    return globalCrypto.randomUUID();
  }

  if (globalCrypto?.getRandomValues) {
    const buffer = new Uint8Array(16);
    globalCrypto.getRandomValues(buffer);
    buffer[6] = (buffer[6] & 0x0f) | 0x40; // version 4
    buffer[8] = (buffer[8] & 0x3f) | 0x80; // variant RFC4122

    const byteToHex: string[] = [];
    for (let i = 0; i < 256; ++i) {
      byteToHex.push((i + 0x100).toString(16).substring(1));
    }

    return (
      byteToHex[buffer[0]] +
      byteToHex[buffer[1]] +
      byteToHex[buffer[2]] +
      byteToHex[buffer[3]] +
      '-' +
      byteToHex[buffer[4]] +
      byteToHex[buffer[5]] +
      '-' +
      byteToHex[buffer[6]] +
      byteToHex[buffer[7]] +
      '-' +
      byteToHex[buffer[8]] +
      byteToHex[buffer[9]] +
      '-' +
      byteToHex[buffer[10]] +
      byteToHex[buffer[11]] +
      byteToHex[buffer[12]] +
      byteToHex[buffer[13]] +
      byteToHex[buffer[14]] +
      byteToHex[buffer[15]]
    );
  }

  let timestamp = Date.now();
  let microTime = (typeof performance !== 'undefined' && performance.now && performance.now() * 1000) || 0;

  return UUID_TEMPLATE.replace(/[xy]/g, (char) => {
    let random = Math.random() * 16;

    if (timestamp > 0) {
      random = (timestamp + random) % 16 | 0;
      timestamp = Math.floor(timestamp / 16);
    } else {
      random = (microTime + random) % 16 | 0;
      microTime = Math.floor(microTime / 16);
    }

    if (char === 'x') {
      return random.toString(16);
    }
    return ((random & 0x3) | 0x8).toString(16);
  });
}

/**
 * Backwards compatible aliases.
 */
export const uuidv4 = generateUUID;
export const generateUniqueId = generateUUID;



