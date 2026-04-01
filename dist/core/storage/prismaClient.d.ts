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
export declare class PrismaClient {
    [key: string]: any;
    constructor();
    private createModelProxy;
}
export type Conversation = PrismaModelRecord;
export type ConversationMessage = PrismaModelRecord;
export type User = PrismaModelRecord;
export type UserApiKey = PrismaModelRecord;
export type UserSession = PrismaModelRecord;
export type Account = PrismaModelRecord;
export type SubscriptionTier = PrismaModelRecord;
export declare const Prisma: {
    TransactionClient: typeof PrismaClient;
    Conversation: PrismaModelRecord;
    ConversationMessage: PrismaModelRecord;
};
export type PrismaTypes = typeof Prisma;
//# sourceMappingURL=prismaClient.d.ts.map