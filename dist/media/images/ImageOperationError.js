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
export class ImageEditNotSupportedError extends Error {
    constructor(providerId) {
        super(`Image editing is not supported by provider "${providerId}".`);
        this.name = 'ImageEditNotSupportedError';
        this.providerId = providerId;
    }
}
/**
 * Thrown when an upscale operation is requested from a provider that does
 * not implement `upscaleImage`.
 *
 * @see {@link ImageEditNotSupportedError} for the editing equivalent.
 */
export class ImageUpscaleNotSupportedError extends Error {
    constructor(providerId) {
        super(`Image upscaling is not supported by provider "${providerId}".`);
        this.name = 'ImageUpscaleNotSupportedError';
        this.providerId = providerId;
    }
}
/**
 * Thrown when a variation operation is requested from a provider that does
 * not implement `variateImage`.
 *
 * @see {@link ImageEditNotSupportedError} for the editing equivalent.
 */
export class ImageVariationNotSupportedError extends Error {
    constructor(providerId) {
        super(`Image variations are not supported by provider "${providerId}".`);
        this.name = 'ImageVariationNotSupportedError';
        this.providerId = providerId;
    }
}
//# sourceMappingURL=ImageOperationError.js.map