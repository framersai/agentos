function nonEmptyString(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}
/**
 * Resolve a stable session key for self-improvement tools.
 *
 * Prefer explicit session-scoped identifiers when available so multiple tool
 * calls in the same run share state, even if each call has a unique
 * correlation ID.
 */
export function resolveSelfImprovementSessionKey(context) {
    const sessionId = nonEmptyString(context.sessionData?.sessionId);
    if (sessionId) {
        return `session:${sessionId}`;
    }
    const conversationId = nonEmptyString(context.sessionData?.conversationId);
    if (conversationId) {
        return `conversation:${conversationId}`;
    }
    const correlationId = nonEmptyString(context.correlationId);
    if (correlationId) {
        return `correlation:${correlationId}`;
    }
    const gmiId = nonEmptyString(context.gmiId);
    if (gmiId) {
        return `gmi:${gmiId}`;
    }
    const personaId = nonEmptyString(context.personaId);
    if (personaId) {
        return `persona:${personaId}`;
    }
    return 'global';
}
//# sourceMappingURL=sessionScope.js.map