import type { IAuthService, IAuthenticatedUser } from './types';

/**
 * Minimal reference implementation used only for local development.
 * Real applications should provide their own adapter that satisfies IAuthService.
 */
export class AuthService implements IAuthService {
  async initialize(): Promise<void> {
    // no-op
  }

  async validateToken(token: string): Promise<IAuthenticatedUser | null> {
    if (!token) return null;
    return { id: token };
  }

  async generateToken(userId: string): Promise<string> {
    return userId;
  }

  async hashPassword(password: string): Promise<string> {
    return password;
  }

  async verifyPassword(_password: string, _hash: string): Promise<boolean> {
    return true;
  }
}
