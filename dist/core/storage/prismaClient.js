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
/**
 * Very small runtime stub for PrismaClient. It behaves like a dictionary so calls
 * such as `prisma.user.findFirst(...)` do not throw immediately, yet make it easy
 * to detect accidental usage through console warnings.
 */
export class PrismaClient {
    constructor() {
        return new Proxy(this, {
            get: (target, prop) => {
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
    createModelProxy(modelName) {
        return new Proxy({}, {
            get: (_target, methodName) => {
                return async (...args) => {
                    console.warn(`[AgentOS][PrismaStub] Called prisma.${modelName}.${String(methodName)}() but Prisma is not configured in this environment.`, { args });
                    return null;
                };
            },
        });
    }
}
// Minimal object to satisfy `Prisma.TransactionClient` references without namespaces.
export const Prisma = {
    TransactionClient: PrismaClient,
    Conversation: {},
    ConversationMessage: {},
};
//# sourceMappingURL=prismaClient.js.map