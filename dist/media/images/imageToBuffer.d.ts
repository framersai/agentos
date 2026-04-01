/**
 * Converts an image input from any of the supported formats into a `Buffer`.
 *
 * Supported input formats:
 * - **`Buffer`** — returned as-is.
 * - **Base64 data URL** — e.g. `data:image/png;base64,iVBOR...`.  The base64
 *   payload is extracted and decoded.
 * - **Raw base64 string** — a string that does not look like a URL or file
 *   path is assumed to be raw base64 data.
 * - **`file://` URL** — resolved to a local filesystem path and read.
 * - **HTTP/HTTPS URL** — fetched via `globalThis.fetch` and buffered.
 * - **Local file path** — any other string is treated as an absolute or
 *   relative filesystem path and read with `fs.readFile`.
 *
 * @param input - The image in any supported format.
 * @returns A `Buffer` containing the raw image bytes.
 *
 * @throws {TypeError} When `input` is neither a string nor a Buffer.
 * @throws {Error} When a remote URL fetch fails or the file cannot be read.
 *
 * @example
 * ```ts
 * const buf1 = await imageToBuffer('data:image/png;base64,iVBOR...');
 * const buf2 = await imageToBuffer(fs.readFileSync('photo.png'));
 * const buf3 = await imageToBuffer('https://example.com/photo.png');
 * const buf4 = await imageToBuffer('/absolute/path/to/image.jpg');
 * ```
 */
export declare function imageToBuffer(input: string | Buffer): Promise<Buffer>;
/**
 * Converts a Node.js `Buffer` into a DOM-compatible `BlobPart`.
 *
 * Recent TypeScript DOM typings require `BlobPart` byte views to be backed by a
 * concrete `ArrayBuffer`, while `Buffer` is typed as `ArrayBufferLike`. Returning
 * a plain `Uint8Array` avoids that mismatch for multipart image uploads.
 *
 * @param input - Raw image bytes stored in a Node.js `Buffer`.
 * @returns An `ArrayBuffer` safe to pass into `new Blob([...])`.
 */
export declare function bufferToBlobPart(input: Buffer): ArrayBuffer;
//# sourceMappingURL=imageToBuffer.d.ts.map