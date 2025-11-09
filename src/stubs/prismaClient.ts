/**
 * Minimal PrismaClient stub used when the real @prisma/client package is not available.
 * The production AgentOS stack relies on Prisma for persistence, but the embedded
 * Voice Chat Assistant runtime uses SQLite + custom repositories. To avoid pulling
 * the heavy Prisma toolchain (especially inside the dev sandbox), we provide a
 * lightweight shim that satisfies TypeScript and runtime imports.
 *
 * The stub intentionally exposes a very small surface area. Any accidental usage
 * of Prisma-backed models at runtime will log a warning so we can catch it early.
 */

export type PrismaModelRecord = Record<string, any>;

/**
 * Very small runtime stub for PrismaClient. It behaves like a dictionary so calls
 * such as `prisma.user.findFirst(...)` do not throw immediately, yet make it easy
 * to detect accidental usage through console warnings.
 */
export class PrismaClient {
  [key: string]: any;

  constructor() {
    return new Proxy(this, {
      get: (target, prop: string) => {
        if (prop === '$connect' || prop === '$disconnect') {
          return async () => undefined;
        }
        if (!(prop in target)) {
          target[prop] = this.createModelProxy(prop);
        }
        return target[prop];
      },
    });
  }

  private createModelProxy(modelName: string) {
    return new Proxy(
      {},
      {
        get: (_target, methodName: string) => {
          return async (...args: any[]) => {
            console.warn(
              `[AgentOS][PrismaStub] Called prisma.${modelName}.${String(
                methodName,
              )}() but Prisma is not configured in this environment.`,
              { args },
            );
            return null;
          };
        },
      },
    );
  }
}

// Common Prisma model aliases used across the AgentOS modules.
export type Conversation = PrismaModelRecord;
export type ConversationMessage = PrismaModelRecord;
export type User = PrismaModelRecord;
export type UserApiKey = PrismaModelRecord;
export type UserSession = PrismaModelRecord;
export type Account = PrismaModelRecord;
export type SubscriptionTier = PrismaModelRecord;

// Minimal namespace to satisfy `Prisma.TransactionClient` references.
export namespace Prisma {
  export type TransactionClient = PrismaClient;
  export type Conversation = PrismaModelRecord;
  export type ConversationMessage = PrismaModelRecord;
}
