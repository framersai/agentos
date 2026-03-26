/**
 * @file imageToBuffer.ts
 * Shared utility for normalising heterogeneous image inputs into a `Buffer`.
 *
 * Image editing, upscaling, and variation APIs accept images in multiple
 * formats (base64 data URLs, raw base64 strings, `Buffer` instances, local
 * file paths, and remote HTTP/HTTPS URLs).  This helper unifies them into
 * a single `Buffer` so that downstream provider code never has to worry
 * about the input shape.
 */
import * as fs from 'node:fs/promises';

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
export async function imageToBuffer(input: string | Buffer): Promise<Buffer> {
  // Already a Buffer — nothing to do.
  if (Buffer.isBuffer(input)) {
    return input;
  }

  if (typeof input !== 'string') {
    throw new TypeError(
      'imageToBuffer: expected a string (base64, URL, or file path) or Buffer.',
    );
  }

  const trimmed = input.trim();

  // Base64 data URL (e.g. "data:image/png;base64,iVBOR...")
  if (trimmed.startsWith('data:')) {
    const commaIdx = trimmed.indexOf(',');
    if (commaIdx === -1) {
      throw new Error('imageToBuffer: malformed data URL — missing comma separator.');
    }
    // Everything after the comma is the base64 payload.
    return Buffer.from(trimmed.slice(commaIdx + 1), 'base64');
  }

  // file:// URL — convert to local path and read.
  if (trimmed.startsWith('file://')) {
    const filePath = new URL(trimmed).pathname;
    return fs.readFile(filePath);
  }

  // Remote HTTP(S) URL — fetch and buffer.
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const response = await globalThis.fetch(trimmed);
    if (!response.ok) {
      throw new Error(
        `imageToBuffer: failed to fetch image from ${trimmed} (${response.status} ${response.statusText}).`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  // Heuristic: if the string contains path separators or a file extension,
  // treat it as a filesystem path.  Otherwise assume raw base64.
  const looksLikePath = trimmed.includes('/') || trimmed.includes('\\') || /\.\w{2,5}$/.test(trimmed);
  if (looksLikePath) {
    return fs.readFile(trimmed);
  }

  // Fallback: raw base64 string (no data URL prefix).
  return Buffer.from(trimmed, 'base64');
}
