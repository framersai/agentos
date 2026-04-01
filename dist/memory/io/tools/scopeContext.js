function nonEmptyString(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}
function buildPersonaScopeId(userId, personaId) {
    return `${userId}::${personaId}`;
}
/**
 * Resolve the effective scope identity for a memory tool call from the active
 * execution context.
 *
 * `user` and `persona` scopes are always resolvable in normal AgentOS tool
 * execution because `userContext.userId` and `personaId` are required.
 * `thread` and `organization` additionally rely on optional `sessionData`.
 */
export function resolveMemoryToolScopeId(scope, context) {
    const resolvedScope = nonEmptyString(scope);
    if (!resolvedScope) {
        return undefined;
    }
    const userId = nonEmptyString(context.userContext?.userId);
    const personaId = nonEmptyString(context.personaId);
    const conversationId = nonEmptyString(context.sessionData?.conversationId) ??
        nonEmptyString(context.sessionData?.sessionId);
    const organizationId = nonEmptyString(context.sessionData?.organizationId) ??
        nonEmptyString(context.userContext?.organizationId);
    switch (resolvedScope) {
        case 'user':
            return userId;
        case 'persona':
            if (!userId || !personaId) {
                return undefined;
            }
            return buildPersonaScopeId(userId, personaId);
        case 'thread':
            return conversationId;
        case 'organization':
            return organizationId;
        default:
            return undefined;
    }
}
//# sourceMappingURL=scopeContext.js.map