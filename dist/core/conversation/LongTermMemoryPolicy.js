export const LONG_TERM_MEMORY_POLICY_METADATA_KEY = 'longTermMemoryPolicy';
export const ORGANIZATION_ID_METADATA_KEY = 'organizationId';
export const DEFAULT_LONG_TERM_MEMORY_POLICY = {
    enabled: true,
    scopes: {
        conversation: true,
        user: false,
        persona: false,
        organization: false,
    },
    shareWithOrganization: false,
    storeAtomicDocs: true,
    allowedCategories: null,
};
const KNOWN_CATEGORIES = new Set([
    'facts',
    'preferences',
    'people',
    'projects',
    'decisions',
    'open_loops',
    'todo',
    'tags',
]);
function normalizeCategory(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed)
        return null;
    return KNOWN_CATEGORIES.has(trimmed)
        ? trimmed
        : null;
}
export function resolveLongTermMemoryPolicy(args) {
    const base = args.defaults ?? DEFAULT_LONG_TERM_MEMORY_POLICY;
    const previous = args.previous ?? null;
    const input = args.input ?? null;
    const resolved = {
        enabled: previous?.enabled ?? base.enabled,
        scopes: {
            conversation: previous?.scopes?.conversation ?? base.scopes.conversation,
            user: previous?.scopes?.user ?? base.scopes.user,
            persona: previous?.scopes?.persona ?? base.scopes.persona,
            organization: previous?.scopes?.organization ?? base.scopes.organization,
        },
        shareWithOrganization: previous?.shareWithOrganization ?? base.shareWithOrganization,
        storeAtomicDocs: previous?.storeAtomicDocs ?? base.storeAtomicDocs,
        allowedCategories: previous?.allowedCategories ?? base.allowedCategories,
    };
    if (input) {
        if (typeof input.enabled === 'boolean')
            resolved.enabled = input.enabled;
        if (input.scopes && typeof input.scopes === 'object') {
            for (const [key, value] of Object.entries(input.scopes)) {
                if (key === 'conversation' || key === 'user' || key === 'persona' || key === 'organization') {
                    if (typeof value === 'boolean') {
                        resolved.scopes[key] = value;
                    }
                }
            }
        }
        if (typeof input.shareWithOrganization === 'boolean') {
            resolved.shareWithOrganization = input.shareWithOrganization;
        }
        if (typeof input.storeAtomicDocs === 'boolean') {
            resolved.storeAtomicDocs = input.storeAtomicDocs;
        }
        if (Array.isArray(input.allowedCategories)) {
            const normalized = Array.from(new Set(input.allowedCategories
                .map((c) => normalizeCategory(c))
                .filter((c) => Boolean(c))));
            resolved.allowedCategories = normalized;
        }
    }
    return resolved;
}
export function hasAnyLongTermMemoryScope(policy) {
    return Boolean(policy?.scopes?.conversation ||
        policy?.scopes?.user ||
        policy?.scopes?.persona ||
        policy?.scopes?.organization);
}
//# sourceMappingURL=LongTermMemoryPolicy.js.map