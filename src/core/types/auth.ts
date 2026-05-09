export interface IAuthenticatedUser {
  id: string;
  email?: string | null;
  username?: string | null;
  roles?: string[];
  tier?: string | null;
  mode?: string | null;
}

export interface IAuthService {
  initialize?(config?: any): Promise<void>;
  validateToken(token: string): Promise<IAuthenticatedUser | null>;
  generateToken?(userId: string): Promise<string> | string;
  hashPassword?(password: string): Promise<string>;
  verifyPassword?(password: string, hash: string): Promise<boolean>;
}

export interface ISubscriptionTier {
  name: string;
  level: number;
  features?: string[];
  isActive?: boolean;
}

export interface ISubscriptionService {
  initialize?(): Promise<void>;
  getUserSubscription(userId: string): Promise<ISubscriptionTier | null>;
  getUserSubscriptionTier?(userId: string): Promise<ISubscriptionTier | null>;
  getTierByName?(tierName: string): Promise<ISubscriptionTier | null>;
  listTiers?(): Promise<ISubscriptionTier[]>;
  validateAccess(userId: string, feature: string): Promise<boolean>;
}
