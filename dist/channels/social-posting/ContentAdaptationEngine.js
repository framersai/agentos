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
// ============================================================================
// Platform Constraints Registry
// ============================================================================
/**
 * Static constraint definitions for all supported social media platforms.
 *
 * Platforms are grouped by category:
 * - Short-form: twitter, threads, bluesky, mastodon, farcaster
 * - Visual-first: instagram, tiktok, pinterest, youtube
 * - Professional/general: linkedin, facebook, reddit, lemmy
 * - Long-form blogging: devto, hashnode, medium, wordpress
 */
const PLATFORM_CONSTRAINTS = {
    // --------------------------------------------------------------------------
    // Short-form Micro-blogging
    // --------------------------------------------------------------------------
    twitter: {
        maxLength: 280,
        hashtagStyle: 'inline',
        maxHashtags: 5,
        supportsMedia: true,
        supportsVideo: true,
        supportsCarousel: false,
        supportsPoll: true,
        supportsThreading: true,
        toneGuidance: 'Concise, punchy, conversational. Use threads for longer content.',
    },
    threads: {
        maxLength: 500,
        hashtagStyle: 'inline',
        maxHashtags: 5,
        supportsMedia: true,
        supportsVideo: true,
        supportsCarousel: true,
        supportsPoll: false,
        supportsThreading: true,
        toneGuidance: 'Conversational, casual, community-oriented.',
    },
    bluesky: {
        maxLength: 300,
        hashtagStyle: 'none',
        maxHashtags: 0,
        supportsMedia: true,
        supportsVideo: true,
        supportsCarousel: false,
        supportsPoll: false,
        supportsThreading: true,
        toneGuidance: 'Authentic, concise. Hashtags use facets (rich text), not inline text.',
    },
    mastodon: {
        maxLength: 500,
        hashtagStyle: 'inline',
        maxHashtags: 10,
        supportsMedia: true,
        supportsVideo: true,
        supportsCarousel: false,
        supportsPoll: true,
        supportsThreading: true,
        toneGuidance: 'Community-conscious, CW (content warning) support encouraged.',
    },
    farcaster: {
        maxLength: 320,
        hashtagStyle: 'none',
        maxHashtags: 0,
        supportsMedia: true,
        supportsVideo: false,
        supportsCarousel: false,
        supportsPoll: false,
        supportsThreading: true,
        toneGuidance: 'Crypto/web3 native, concise, authentic.',
    },
    // --------------------------------------------------------------------------
    // Visual-First Platforms
    // --------------------------------------------------------------------------
    instagram: {
        maxLength: 2200,
        hashtagStyle: 'footer',
        maxHashtags: 30,
        supportsMedia: true,
        supportsVideo: true,
        supportsCarousel: true,
        supportsPoll: false,
        supportsThreading: false,
        toneGuidance: 'Visual-first, storytelling, hashtags in footer block.',
    },
    tiktok: {
        maxLength: 2200,
        hashtagStyle: 'inline',
        maxHashtags: 10,
        supportsMedia: false,
        supportsVideo: true,
        supportsCarousel: false,
        supportsPoll: false,
        supportsThreading: false,
        toneGuidance: 'Trendy, authentic, short-form video focused.',
    },
    pinterest: {
        maxLength: 500,
        hashtagStyle: 'none',
        maxHashtags: 0,
        supportsMedia: true,
        supportsVideo: true,
        supportsCarousel: true,
        supportsPoll: false,
        supportsThreading: false,
        toneGuidance: 'Keyword-rich, descriptive, aspirational. Focus on discoverability.',
    },
    youtube: {
        maxLength: 5000,
        hashtagStyle: 'inline',
        maxHashtags: 15,
        supportsMedia: false,
        supportsVideo: true,
        supportsCarousel: false,
        supportsPoll: true,
        supportsThreading: false,
        toneGuidance: 'Descriptive, SEO-aware. This is the video description field.',
    },
    // --------------------------------------------------------------------------
    // Professional & General Social
    // --------------------------------------------------------------------------
    linkedin: {
        maxLength: 3000,
        hashtagStyle: 'footer',
        maxHashtags: 5,
        supportsMedia: true,
        supportsVideo: true,
        supportsCarousel: true,
        supportsPoll: true,
        supportsThreading: false,
        toneGuidance: 'Professional, thought-leadership, industry insights.',
    },
    facebook: {
        maxLength: 63206,
        hashtagStyle: 'inline',
        maxHashtags: 10,
        supportsMedia: true,
        supportsVideo: true,
        supportsCarousel: true,
        supportsPoll: true,
        supportsThreading: false,
        toneGuidance: 'Casual, community-driven, longer-form acceptable.',
    },
    reddit: {
        maxLength: 40000,
        hashtagStyle: 'none',
        maxHashtags: 0,
        supportsMedia: true,
        supportsVideo: true,
        supportsCarousel: false,
        supportsPoll: true,
        supportsThreading: false,
        toneGuidance: 'Community-specific, informative, no hashtags. Markdown supported.',
    },
    lemmy: {
        maxLength: 10000,
        hashtagStyle: 'none',
        maxHashtags: 0,
        supportsMedia: true,
        supportsVideo: false,
        supportsCarousel: false,
        supportsPoll: false,
        supportsThreading: false,
        toneGuidance: 'Community-focused, federated. Markdown supported.',
    },
    // --------------------------------------------------------------------------
    // Long-Form Blogging
    // --------------------------------------------------------------------------
    devto: {
        maxLength: 100000,
        hashtagStyle: 'none',
        maxHashtags: 0,
        supportsMedia: true,
        supportsVideo: false,
        supportsCarousel: false,
        supportsPoll: false,
        supportsThreading: false,
        toneGuidance: 'Developer-focused, technical, tutorial-style. Markdown/front-matter.',
    },
    hashnode: {
        maxLength: 100000,
        hashtagStyle: 'none',
        maxHashtags: 0,
        supportsMedia: true,
        supportsVideo: false,
        supportsCarousel: false,
        supportsPoll: false,
        supportsThreading: false,
        toneGuidance: 'Developer blogging, technical depth, markdown.',
    },
    medium: {
        maxLength: 100000,
        hashtagStyle: 'none',
        maxHashtags: 0,
        supportsMedia: true,
        supportsVideo: false,
        supportsCarousel: false,
        supportsPoll: false,
        supportsThreading: false,
        toneGuidance: 'Narrative, polished, long-form essays and thought pieces.',
    },
    wordpress: {
        maxLength: 100000,
        hashtagStyle: 'none',
        maxHashtags: 0,
        supportsMedia: true,
        supportsVideo: true,
        supportsCarousel: false,
        supportsPoll: false,
        supportsThreading: false,
        toneGuidance: 'Flexible — depends on blog style. HTML and shortcodes supported.',
    },
};
// ============================================================================
// ContentAdaptationEngine
// ============================================================================
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
export class ContentAdaptationEngine {
    // --------------------------------------------------------------------------
    // Public API
    // --------------------------------------------------------------------------
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
    adaptContent(baseContent, platforms, hashtags) {
        const results = {};
        for (const platform of platforms) {
            results[platform] = this.adaptForPlatform(baseContent, platform, hashtags);
        }
        return results;
    }
    /**
     * Retrieve the constraint definition for a platform.
     *
     * Returns a default constraint set for unknown platforms (10000 chars,
     * no hashtags, basic media support).
     *
     * @param platform - Platform identifier
     * @returns The PlatformConstraints for the given platform
     */
    getConstraints(platform) {
        return PLATFORM_CONSTRAINTS[platform] ?? this.getDefaultConstraints();
    }
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
    truncateWithEllipsis(text, maxLength) {
        if (text.length <= maxLength) {
            return text;
        }
        const ellipsis = '...';
        const targetLength = maxLength - ellipsis.length;
        if (targetLength <= 0) {
            return text.slice(0, maxLength);
        }
        // Try to break at a word boundary
        const truncated = text.slice(0, targetLength);
        const lastSpace = truncated.lastIndexOf(' ');
        // Only break at word boundary if it's within 30 chars of the target
        if (lastSpace > 0 && targetLength - lastSpace < 30) {
            return truncated.slice(0, lastSpace) + ellipsis;
        }
        return truncated + ellipsis;
    }
    // --------------------------------------------------------------------------
    // Internal Helpers
    // --------------------------------------------------------------------------
    /**
     * Adapt content for a single platform.
     */
    adaptForPlatform(baseContent, platform, hashtags) {
        const constraints = this.getConstraints(platform);
        const warnings = [];
        // Normalize and limit hashtags
        const normalizedHashtags = this.normalizeHashtags(hashtags ?? [], constraints.maxHashtags);
        if (hashtags && hashtags.length > constraints.maxHashtags) {
            warnings.push(`Hashtag count (${hashtags.length}) exceeds platform maximum (${constraints.maxHashtags}). ` +
                `Truncated to ${constraints.maxHashtags}.`);
        }
        // Build the full text with hashtags placed according to platform style
        let fullText = this.formatWithHashtags(baseContent, normalizedHashtags, constraints.hashtagStyle);
        // Check for truncation
        let truncated = false;
        if (fullText.length > constraints.maxLength) {
            // If hashtags are in footer, try truncating just the content
            if (constraints.hashtagStyle === 'footer' &&
                normalizedHashtags.length > 0) {
                const hashtagBlock = this.buildHashtagBlock(normalizedHashtags);
                const contentBudget = constraints.maxLength - hashtagBlock.length - 2; // 2 for '\n\n'
                if (contentBudget > 0) {
                    const truncatedContent = this.truncateWithEllipsis(baseContent, contentBudget);
                    fullText = truncatedContent + '\n\n' + hashtagBlock;
                    truncated = true;
                }
                else {
                    fullText = this.truncateWithEllipsis(fullText, constraints.maxLength);
                    truncated = true;
                }
            }
            else {
                fullText = this.truncateWithEllipsis(fullText, constraints.maxLength);
                truncated = true;
            }
            warnings.push(`Content truncated from ${baseContent.length} to fit ${platform}'s ` +
                `${constraints.maxLength} character limit.`);
        }
        // Platform-specific warnings
        if (platform === 'bluesky' && hashtags && hashtags.length > 0) {
            warnings.push('Bluesky uses facets (rich text) for hashtags, not inline text. ' +
                'Hashtags have been omitted from the text. Apply them via the AT Protocol facets API.');
        }
        if (platform === 'mastodon') {
            warnings.push('Consider adding a Content Warning (CW) if the content is sensitive.');
        }
        return {
            platform,
            text: fullText,
            hashtags: normalizedHashtags,
            truncated,
            mediaSupported: constraints.supportsMedia,
            warnings,
        };
    }
    /**
     * Normalize hashtags: ensure '#' prefix, deduplicate, and limit count.
     */
    normalizeHashtags(hashtags, maxCount) {
        if (maxCount === 0)
            return [];
        const seen = new Set();
        const normalized = [];
        for (const tag of hashtags) {
            const cleaned = tag.startsWith('#') ? tag : `#${tag}`;
            const lower = cleaned.toLowerCase();
            if (!seen.has(lower) && normalized.length < maxCount) {
                seen.add(lower);
                normalized.push(cleaned);
            }
        }
        return normalized;
    }
    /**
     * Format content with hashtags according to the platform's style.
     */
    formatWithHashtags(content, hashtags, style) {
        if (hashtags.length === 0 || style === 'none') {
            return content;
        }
        if (style === 'footer') {
            const hashtagBlock = this.buildHashtagBlock(hashtags);
            return content + '\n\n' + hashtagBlock;
        }
        // Inline: append hashtags after the content with a space
        return content + ' ' + hashtags.join(' ');
    }
    /**
     * Build a hashtag block string for footer-style placement.
     */
    buildHashtagBlock(hashtags) {
        return hashtags.join(' ');
    }
    /**
     * Default constraints for unknown platforms.
     */
    getDefaultConstraints() {
        return {
            maxLength: 10000,
            hashtagStyle: 'inline',
            maxHashtags: 10,
            supportsMedia: true,
            supportsVideo: true,
            supportsCarousel: false,
            supportsPoll: false,
            supportsThreading: false,
            toneGuidance: 'General purpose. Adapt to the specific platform context.',
        };
    }
}
//# sourceMappingURL=ContentAdaptationEngine.js.map