/**
 * @file Rate Limit Type Definitions
 * @description Type definitions for rate limit information.
 * Ensures consistent structure for public/private rate limit views.
 */
/**
 * Rate limit information for authenticated users (unlimited access).
 */
export interface RateLimitInfoAuthenticated {
    tier: 'authenticated';
    message?: string;
}
/**
 * Rate limit information for public (unauthenticated) users with IP-based limits.
 */
export interface RateLimitInfoPublic {
    tier: 'public';
    ip: string | null;
    used: number;
    limit: number;
    remaining: number;
    resetAt: string | Date | null;
    storeType?: string;
    message?: string;
}
/**
 * Unified rate limit information discriminated by tier.
 */
export type RateLimitInfo = RateLimitInfoAuthenticated | RateLimitInfoPublic;
/**
 * Type guard to check if rate limit info is for public tier.
 */
export declare function isPublicRateLimit(info: RateLimitInfo): info is RateLimitInfoPublic;
/**
 * Type guard to check if rate limit info is for authenticated tier.
 */
export declare function isAuthenticatedRateLimit(info: RateLimitInfo): info is RateLimitInfoAuthenticated;
/**
 * Banner threshold configuration for rate limit warnings.
 */
export interface RateLimitBannerThresholds {
    /**
     * Show warning banner when remaining requests drop below this percentage.
     * @default 25
     */
    warningThreshold: number;
    /**
     * Show critical banner when remaining requests drop below this percentage.
     * @default 10
     */
    criticalThreshold: number;
}
/**
 * Default banner thresholds for rate limit warnings.
 */
export declare const DEFAULT_RATE_LIMIT_BANNER_THRESHOLDS: RateLimitBannerThresholds;
/**
 * Calculate remaining percentage from rate limit info.
 * @param info Rate limit information (must be public tier)
 * @returns Percentage of remaining requests (0-100), or null if not applicable
 */
export declare function calculateRemainingPercentage(info: RateLimitInfo): number | null;
/**
 * Determine banner severity based on remaining percentage and thresholds.
 * @param info Rate limit information
 * @param thresholds Banner threshold configuration (optional, uses defaults)
 * @returns 'none' | 'warning' | 'critical'
 */
export declare function getRateLimitBannerSeverity(info: RateLimitInfo, thresholds?: RateLimitBannerThresholds): 'none' | 'warning' | 'critical';
//# sourceMappingURL=types.d.ts.map