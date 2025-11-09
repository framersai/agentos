/**
 * @file Rate Limit Types Tests
 * @description Tests for rate limit type utilities and type guards.
 */

import { describe, it, expect } from 'vitest';
import type { RateLimitInfo, RateLimitInfoPublic, RateLimitInfoAuthenticated } from '../../src/types/rateLimitTypes.js';
import {
  isPublicRateLimit,
  isAuthenticatedRateLimit,
  calculateRemainingPercentage,
  getRateLimitBannerSeverity,
  DEFAULT_RATE_LIMIT_BANNER_THRESHOLDS,
} from '../../src/types/rateLimitTypes.js';

describe('Rate Limit Type Guards', () => {
  it('identifies public rate limit info correctly', () => {
    const publicInfo: RateLimitInfoPublic = {
      tier: 'public',
      ip: '192.168.1.1',
      used: 50,
      limit: 100,
      remaining: 50,
      resetAt: new Date().toISOString(),
    };

    expect(isPublicRateLimit(publicInfo)).toBe(true);
    expect(isAuthenticatedRateLimit(publicInfo)).toBe(false);
  });

  it('identifies authenticated rate limit info correctly', () => {
    const authInfo: RateLimitInfoAuthenticated = {
      tier: 'authenticated',
      message: 'Unlimited access',
    };

    expect(isAuthenticatedRateLimit(authInfo)).toBe(true);
    expect(isPublicRateLimit(authInfo)).toBe(false);
  });
});

describe('calculateRemainingPercentage', () => {
  it('returns correct percentage for public tier', () => {
    const info: RateLimitInfoPublic = {
      tier: 'public',
      ip: '10.0.0.1',
      used: 75,
      limit: 100,
      remaining: 25,
      resetAt: null,
    };

    expect(calculateRemainingPercentage(info)).toBe(25);
  });

  it('returns null for authenticated tier', () => {
    const info: RateLimitInfoAuthenticated = {
      tier: 'authenticated',
    };

    expect(calculateRemainingPercentage(info)).toBeNull();
  });

  it('returns null when limit is zero', () => {
    const info: RateLimitInfoPublic = {
      tier: 'public',
      ip: '10.0.0.1',
      used: 0,
      limit: 0,
      remaining: 0,
      resetAt: null,
    };

    expect(calculateRemainingPercentage(info)).toBeNull();
  });

  it('calculates 0% correctly when fully exhausted', () => {
    const info: RateLimitInfoPublic = {
      tier: 'public',
      ip: '10.0.0.1',
      used: 100,
      limit: 100,
      remaining: 0,
      resetAt: null,
    };

    expect(calculateRemainingPercentage(info)).toBe(0);
  });

  it('calculates 100% correctly when unused', () => {
    const info: RateLimitInfoPublic = {
      tier: 'public',
      ip: '10.0.0.1',
      used: 0,
      limit: 100,
      remaining: 100,
      resetAt: null,
    };

    expect(calculateRemainingPercentage(info)).toBe(100);
  });
});

describe('getRateLimitBannerSeverity', () => {
  it('returns "none" for authenticated tier', () => {
    const info: RateLimitInfoAuthenticated = {
      tier: 'authenticated',
    };

    expect(getRateLimitBannerSeverity(info)).toBe('none');
  });

  it('returns "critical" when remaining is 0', () => {
    const info: RateLimitInfoPublic = {
      tier: 'public',
      ip: '10.0.0.1',
      used: 100,
      limit: 100,
      remaining: 0,
      resetAt: null,
    };

    expect(getRateLimitBannerSeverity(info)).toBe('critical');
  });

  it('returns "critical" when below critical threshold (10%)', () => {
    const info: RateLimitInfoPublic = {
      tier: 'public',
      ip: '10.0.0.1',
      used: 91,
      limit: 100,
      remaining: 9,
      resetAt: null,
    };

    expect(getRateLimitBannerSeverity(info)).toBe('critical');
  });

  it('returns "warning" when below warning threshold (25%) but above critical', () => {
    const info: RateLimitInfoPublic = {
      tier: 'public',
      ip: '10.0.0.1',
      used: 80,
      limit: 100,
      remaining: 20,
      resetAt: null,
    };

    expect(getRateLimitBannerSeverity(info)).toBe('warning');
  });

  it('returns "none" when above warning threshold', () => {
    const info: RateLimitInfoPublic = {
      tier: 'public',
      ip: '10.0.0.1',
      used: 50,
      limit: 100,
      remaining: 50,
      resetAt: null,
    };

    expect(getRateLimitBannerSeverity(info)).toBe('none');
  });

  it('respects custom thresholds', () => {
    const info: RateLimitInfoPublic = {
      tier: 'public',
      ip: '10.0.0.1',
      used: 60,
      limit: 100,
      remaining: 40,
      resetAt: null,
    };

    const customThresholds = {
      warningThreshold: 50,
      criticalThreshold: 20,
    };

    expect(getRateLimitBannerSeverity(info, customThresholds)).toBe('warning');
  });

  it('uses default thresholds when not provided', () => {
    const info: RateLimitInfoPublic = {
      tier: 'public',
      ip: '10.0.0.1',
      used: 80,
      limit: 100,
      remaining: 20,
      resetAt: null,
    };

    expect(getRateLimitBannerSeverity(info)).toBe('warning');
    expect(DEFAULT_RATE_LIMIT_BANNER_THRESHOLDS.warningThreshold).toBe(25);
    expect(DEFAULT_RATE_LIMIT_BANNER_THRESHOLDS.criticalThreshold).toBe(10);
  });

  it('returns "none" when limit is 0 (edge case)', () => {
    const info: RateLimitInfoPublic = {
      tier: 'public',
      ip: '10.0.0.1',
      used: 0,
      limit: 0,
      remaining: 0,
      resetAt: null,
    };

    expect(getRateLimitBannerSeverity(info)).toBe('none');
  });
});

describe('RateLimitInfo Discriminated Union', () => {
  it('allows type narrowing with type guards', () => {
    const info: RateLimitInfo = {
      tier: 'public',
      ip: '127.0.0.1',
      used: 10,
      limit: 100,
      remaining: 90,
      resetAt: new Date().toISOString(),
    };

    if (isPublicRateLimit(info)) {
      // TypeScript should know info is RateLimitInfoPublic here
      expect(info.ip).toBeDefined();
      expect(info.used).toBe(10);
      expect(info.remaining).toBe(90);
    } else {
      // Should not reach here
      expect.fail('Expected public rate limit');
    }
  });

  it('handles authenticated tier in discriminated union', () => {
    const info: RateLimitInfo = {
      tier: 'authenticated',
      message: 'Welcome back!',
    };

    if (isAuthenticatedRateLimit(info)) {
      // TypeScript should know info is RateLimitInfoAuthenticated here
      expect(info.message).toBe('Welcome back!');
    } else {
      // Should not reach here
      expect.fail('Expected authenticated rate limit');
    }
  });
});
