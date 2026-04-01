/**
 * @file prompts.ts
 * Prompt construction utilities for avatar image generation.
 *
 * Builds deterministic text prompts from {@link AvatarIdentityDescriptor}
 * fields, producing consistent character depictions across emotion variants,
 * emote animations, and full-body shots.
 */
import type { AvatarIdentityDescriptor } from '../../api/types.js';
/**
 * Canonical set of emotions for expression sheets and animated emotes.
 * The first entry is always "neutral" — it doubles as the anchor portrait.
 */
export declare const AVATAR_EMOTIONS: readonly ["neutral", "happy", "sad", "angry", "surprised", "flirty", "fearful"];
/** Union type of supported avatar emotions. */
export type AvatarEmotion = (typeof AVATAR_EMOTIONS)[number];
/**
 * Concatenate all identity descriptor fields into a portrait prompt.
 *
 * Produces a detailed, comma-separated description suitable for
 * text-to-image models. Omits undefined optional fields.
 *
 * @param identity - Character identity descriptors.
 * @returns Prompt string for a neutral portrait.
 */
export declare function buildPortraitPrompt(identity: AvatarIdentityDescriptor): string;
/**
 * Build a prompt for a specific emotion expression of the character.
 *
 * Appends the emotion keyword to the base portrait prompt so the model
 * generates the same face with the requested expression.
 *
 * @param identity - Character identity descriptors.
 * @param emotion - Target emotion expression.
 * @returns Prompt string for an emotion-specific portrait.
 */
export declare function buildExpressionPrompt(identity: AvatarIdentityDescriptor, emotion: AvatarEmotion | string): string;
/**
 * Build a prompt for an animated emote loop of a given emotion.
 *
 * Produces a concise prompt targeting short animation generation models
 * (e.g. Stable Video Diffusion, AnimateDiff).
 *
 * @param emotion - The emotion to animate.
 * @returns Prompt string for an animated emote.
 */
export declare function buildEmotePrompt(emotion: AvatarEmotion | string): string;
//# sourceMappingURL=prompts.d.ts.map