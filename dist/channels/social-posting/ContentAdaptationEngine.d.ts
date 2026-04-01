/**
 * @fileoverview Content Adaptation Engine — platform-specific content transformation.
 * @module @framers/agentos/social-posting/ContentAdaptationEngine
 *
 * Applies static, deterministic rules to adapt a base content string for
 * each target social media platform. The engine enforces character limits,
 * hashtag placement, and generates platform-specific warnings.
 *
 * LLM-powered adaptation (tone rewriting, audience targeting, etc.) is
 * intentionally left to the skill layer. This module provides the
 * constraint-aware foundation that skills can build upon.
 *
 * @example
 * ```typescript
 * import { ContentAdaptationEngine } from '@framers/agentos/social-posting';
 *
 * const engine = new ContentAdaptationEngine();
 *
 * const adapted = engine.adaptContent(
 *   'Announcing our new feature! Check it out at https://example.com',
 *   ['twitter', 'linkedin', 'instagram'],
 *   ['announcement', 'product'],
 * );
 *
 * console.log(adapted.twitter.text);     // Truncated to 280 chars if needed
 * console.log(adapted.instagram.hashtags); // ['#announcement', '#product']
 * ```
 */
/**
 * Content constraints and capabilities for a social media platform.
 */
export interface PlatformConstraints {
    /** Maximum character length for a post. */
    maxLength: number;
    /** How hashtags should be positioned in the content. */
    hashtagStyle: 'inline' | 'footer' | 'none';
    /** Maximum number of hashtags allowed. */
    maxHashtags: number;
    /** Whether the platform supports image/photo attachments. */
    supportsMedia: boolean;
    /** Whether the platform supports video attachments. */
    supportsVideo: boolean;
    /** Whether the platform supports multi-image carousel posts. */
    supportsCarousel: boolean;
    /** Whether the platform supports poll creation. */
    supportsPoll: boolean;
    /** Whether the platform supports threaded/chained posts. */
    supportsThreading: boolean;
    /** Brief guidance on the expected tone for this platform. */
    toneGuidance: string;
}
/**
 * The result of adapting content for a single platform.
 */
export interface AdaptedContent {
    /** Target platform identifier. */
    platform: string;
    /** The adapted text content, truncated and formatted for the platform. */
    text: string;
    /** Extracted or generated hashtags (with '#' prefix). */
    hashtags: string[];
    /** Whether the text was truncated to fit the platform's maxLength. */
    truncated: boolean;
    /** Whether the platform supports media attachments. */
    mediaSupported: boolean;
    /** Platform-specific warnings (e.g. content too long, unsupported features). */
    warnings: string[];
}
/**
 * Adapts base content for multiple social media platforms using static rules.
 *
 * The engine applies character limits, hashtag formatting, and generates
 * warnings when content exceeds platform constraints. It does **not** perform
 * LLM-based rewriting — that responsibility belongs to the skill layer which
 * can call the engine's constraint methods to inform its prompts.
 *
 * @example
 * ```typescript
 * const engine = new ContentAdaptationEngine();
 * const results = engine.adaptContent(
 *   'We just shipped dark mode! Try it out.',
 *   ['twitter', 'linkedin'],
 *   ['darkmode', 'shipping'],
 * );
 *
 * // results.twitter.text  --> 'We just shipped dark mode! Try it out. #darkmode #shipping'
 * // results.linkedin.text --> 'We just shipped dark mode! Try it out.\n\n#darkmode #shipping'
 * ```
 */
export declare class ContentAdaptationEngine {
    /**
     * Adapt base content for one or more target platforms.
     *
     * For each platform, the engine:
     * 1. Formats hashtags according to the platform's hashtagStyle
     * 2. Truncates content if it exceeds the platform's maxLength
     * 3. Generates warnings for any constraint violations
     *
     * @param baseContent - The original, platform-agnostic content
     * @param platforms   - Target platform identifiers
     * @param hashtags    - Optional hashtags (without '#' prefix)
     * @returns A record mapping each platform to its adapted content
     */
    adaptContent(baseContent: string, platforms: string[], hashtags?: string[]): Record<string, AdaptedContent>;
    /**
     * Retrieve the constraint definition for a platform.
     *
     * Returns a default constraint set for unknown platforms (10000 chars,
     * no hashtags, basic media support).
     *
     * @param platform - Platform identifier
     * @returns The PlatformConstraints for the given platform
     */
    getConstraints(platform: string): PlatformConstraints;
    /**
     * Truncate text to a maximum length, appending an ellipsis if truncated.
     *
     * Attempts to break at a word boundary to avoid cutting words mid-token.
     * If no word boundary is found within the last 30 characters, truncates
     * at the hard limit.
     *
     * @param text      - The text to truncate
     * @param maxLength - Maximum allowed length (including ellipsis)
     * @returns The truncated text, or the original if within limits
     */
    truncateWithEllipsis(text: string, maxLength: number): string;
    /**
     * Adapt content for a single platform.
     */
    private adaptForPlatform;
    /**
     * Normalize hashtags: ensure '#' prefix, deduplicate, and limit count.
     */
    private normalizeHashtags;
    /**
     * Format content with hashtags according to the platform's style.
     */
    private formatWithHashtags;
    /**
     * Build a hashtag block string for footer-style placement.
     */
    private buildHashtagBlock;
    /**
     * Default constraints for unknown platforms.
     */
    private getDefaultConstraints;
}
//# sourceMappingURL=ContentAdaptationEngine.d.ts.map