import { describe, expect, it } from 'vitest';

import { bufferToBlobPart } from '../imageToBuffer.js';

describe('bufferToBlobPart', () => {
  it('converts Buffer data into a Blob-compatible Uint8Array', async () => {
    const bytes = bufferToBlobPart(Buffer.from([1, 2, 3, 4]));

    expect(bytes).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3, 4]));

    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});
