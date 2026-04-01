/**
 * @file Rate Limit Type Definitions
 * @description Type definitions for rate limit information.
 * Ensures consistent structure for public/private rate limit views.
 */
/**
 * Type guard to check if rate limit info is for public tier.
 */
export function isPublicRateLimit(info) {
    return info.tier === 'public';
}
/**
 * Type guard to check if rate limit info is for authenticated tier.
 */
export function isAuthenticatedRateLimit(info) {
    return info.tier === 'authenticated';
}
/**
 * Default banner thresholds for rate limit warnings.
 */
export const DEFAULT_RATE_LIMIT_BANNER_THRESHOLDS = {
    warningThreshold: 25,
    criticalThreshold: 10,
};
/**
 * Calculate remaining percentage from rate limit info.
 * @param info Rate limit information (must be public tier)
 * @returns Percentage of remaining requests (0-100), or null if not applicable
 */
export function calculateRemainingPercentage(info) {
    if (!isPublicRateLimit(info) || info.limit === 0)
        return null;
    return (info.remaining / info.limit) * 100;
}
/**
 * Determine banner severity based on remaining percentage and thresholds.
 * @param info Rate limit information
 * @param thresholds Banner threshold configuration (optional, uses defaults)
 * @returns 'none' | 'warning' | 'critical'
 */
export function getRateLimitBannerSeverity(info, thresholds = DEFAULT_RATE_LIMIT_BANNER_THRESHOLDS) {
    if (!isPublicRateLimit(info))
        return 'none';
    const remainingPct = calculateRemainingPercentage(info);
    if (remainingPct === null)
        return 'none';
    if (remainingPct === 0 || info.remaining === 0)
        return 'critical';
    if (remainingPct <= thresholds.criticalThreshold)
        return 'critical';
    if (remainingPct <= thresholds.warningThreshold)
        return 'warning';
    return 'none';
}
//# sourceMappingURL=types.js.map