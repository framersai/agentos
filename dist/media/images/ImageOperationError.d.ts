/**
 * @file ImageOperationError.ts
 * Custom error types for unsupported image operations.
 *
 * These errors are thrown by the high-level API functions (editImage,
 * upscaleImage, variateImage) when the resolved provider does not
 * implement the requested capability.  Callers can catch these by class
 * to provide actionable error messages or fall back to another provider.
 */
/**
 * Thrown when an image editing operation (img2img, inpaint, outpaint) is
 * requested from a provider that does not implement `editImage`.
 *
 * @example
 * ```ts
 * try {
 *   await editImage({ provider: 'openrouter', image: buf, prompt: '...' });
 * } catch (err) {
 *   if (err instanceof ImageEditNotSupportedError) {
 *     console.log('Try a different provider for editing.');
 *   }
 * }
 * ```
 */
export declare class ImageEditNotSupportedError extends Error {
    /** The provider that was asked to perform the edit. */
    readonly providerId: string;
    constructor(providerId: string);
}
/**
 * Thrown when an upscale operation is requested from a provider that does
 * not implement `upscaleImage`.
 *
 * @see {@link ImageEditNotSupportedError} for the editing equivalent.
 */
export declare class ImageUpscaleNotSupportedError extends Error {
    /** The provider that was asked to perform the upscale. */
    readonly providerId: string;
    constructor(providerId: string);
}
/**
 * Thrown when a variation operation is requested from a provider that does
 * not implement `variateImage`.
 *
 * @see {@link ImageEditNotSupportedError} for the editing equivalent.
 */
export declare class ImageVariationNotSupportedError extends Error {
    /** The provider that was asked to produce variations. */
    readonly providerId: string;
    constructor(providerId: string);
}
//# sourceMappingURL=ImageOperationError.d.ts.map