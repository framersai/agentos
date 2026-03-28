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
  storeType?: string; // 'Redis' | 'In-Memory' | 'Error' etc. (optional, for debugging)
  message?: string;
}

/**
 * Unified rate limit information discriminated by tier.
 */
export type RateLimitInfo = RateLimitInfoAuthenticated | RateLimitInfoPublic;

/**
 * Type guard to check if rate limit info is for public tier.
 */
export function isPublicRateLimit(info: RateLimitInfo): info is RateLimitInfoPublic {
  return info.tier === 'public';
}

/**
 * Type guard to check if rate limit info is for authenticated tier.
 */
export function isAuthenticatedRateLimit(info: RateLimitInfo): info is RateLimitInfoAuthenticated {
  return info.tier === 'authenticated';
}

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
export const DEFAULT_RATE_LIMIT_BANNER_THRESHOLDS: RateLimitBannerThresholds = {
  warningThreshold: 25,
  criticalThreshold: 10,
};

/**
 * Calculate remaining percentage from rate limit info.
 * @param info Rate limit information (must be public tier)
 * @returns Percentage of remaining requests (0-100), or null if not applicable
 */
export function calculateRemainingPercentage(info: RateLimitInfo): number | null {
  if (!isPublicRateLimit(info) || info.limit === 0) return null;
  return (info.remaining / info.limit) * 100;
}

/**
 * Determine banner severity based on remaining percentage and thresholds.
 * @param info Rate limit information
 * @param thresholds Banner threshold configuration (optional, uses defaults)
 * @returns 'none' | 'warning' | 'critical'
 */
export function getRateLimitBannerSeverity(
  info: RateLimitInfo,
  thresholds: RateLimitBannerThresholds = DEFAULT_RATE_LIMIT_BANNER_THRESHOLDS
): 'none' | 'warning' | 'critical' {
  if (!isPublicRateLimit(info)) return 'none';
  
  const remainingPct = calculateRemainingPercentage(info);
  if (remainingPct === null) return 'none';
  
  if (remainingPct === 0 || info.remaining === 0) return 'critical';
  if (remainingPct <= thresholds.criticalThreshold) return 'critical';
  if (remainingPct <= thresholds.warningThreshold) return 'warning';
  
  return 'none';
}
