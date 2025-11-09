import type { ISubscriptionService, ISubscriptionTier } from './types';

const DEFAULT_TIERS: ISubscriptionTier[] = [
  { name: 'basic', level: 0, features: [], isActive: true },
  { name: 'pro', level: 1, features: ['FEATURE_ADVANCED_SEARCH'], isActive: true },
];

/**
 * Minimal stub subscription service. Real deployments should inject their own implementation.
 */
export class SubscriptionService implements ISubscriptionService {
  private readonly tiers: ISubscriptionTier[] = DEFAULT_TIERS;

  async initialize(): Promise<void> {
    // no-op
  }

  async getUserSubscription(userId: string): Promise<ISubscriptionTier | null> {
    if (!userId) {
      return null;
    }
    return this.tiers[0];
  }

  async getUserSubscriptionTier(userId: string): Promise<ISubscriptionTier | null> {
    return this.getUserSubscription(userId);
  }

  async getTierByName(tierName: string): Promise<ISubscriptionTier | null> {
    return this.tiers.find(tier => tier.name === tierName) ?? null;
  }

  async listTiers(): Promise<ISubscriptionTier[]> {
    return [...this.tiers];
  }

  async validateAccess(_userId: string, _feature: string): Promise<boolean> {
    return true;
  }
}
