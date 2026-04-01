/**
 * @file prompts.ts
 * Prompt construction utilities for avatar image generation.
 *
 * Builds deterministic text prompts from {@link AvatarIdentityDescriptor}
 * fields, producing consistent character depictions across emotion variants,
 * emote animations, and full-body shots.
 */
// ---------------------------------------------------------------------------
// Emotion catalogue
// ---------------------------------------------------------------------------
/**
 * Canonical set of emotions for expression sheets and animated emotes.
 * The first entry is always "neutral" — it doubles as the anchor portrait.
 */
export const AVATAR_EMOTIONS = [
    'neutral',
    'happy',
    'sad',
    'angry',
    'surprised',
    'flirty',
    'fearful',
];
// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------
/**
 * Concatenate all identity descriptor fields into a portrait prompt.
 *
 * Produces a detailed, comma-separated description suitable for
 * text-to-image models. Omits undefined optional fields.
 *
 * @param identity - Character identity descriptors.
 * @returns Prompt string for a neutral portrait.
 */
export function buildPortraitPrompt(identity) {
    const parts = [];
    parts.push(`portrait of ${identity.displayName}`);
    parts.push(`${identity.ageBand.replace(/_/g, ' ')} age`);
    if (identity.bodyType) {
        parts.push(`${identity.bodyType} build`);
    }
    parts.push(identity.faceDescriptor);
    if (identity.hairDescriptor) {
        parts.push(identity.hairDescriptor);
    }
    if (identity.skinDescriptor) {
        parts.push(identity.skinDescriptor);
    }
    if (identity.distinguishingFeatures) {
        parts.push(identity.distinguishingFeatures);
    }
    if (identity.styleNotes) {
        parts.push(identity.styleNotes);
    }
    return parts.join(', ');
}
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
export function buildExpressionPrompt(identity, emotion) {
    const base = buildPortraitPrompt(identity);
    if (emotion === 'neutral') {
        return base;
    }
    return `${base}, ${emotion} expression`;
}
/**
 * Build a prompt for an animated emote loop of a given emotion.
 *
 * Produces a concise prompt targeting short animation generation models
 * (e.g. Stable Video Diffusion, AnimateDiff).
 *
 * @param emotion - The emotion to animate.
 * @returns Prompt string for an animated emote.
 */
export function buildEmotePrompt(emotion) {
    return `animated emote loop, ${emotion} expression, character portrait, seamless loop`;
}
//# sourceMappingURL=prompts.js.map