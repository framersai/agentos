import secretCatalog from './extension-secrets.json' with { type: 'json' };
export const EXTENSION_SECRET_DEFINITIONS = secretCatalog;
const providerToSecret = new Map();
for (const definition of EXTENSION_SECRET_DEFINITIONS) {
    if (!definition.providers) {
        continue;
    }
    for (const provider of definition.providers) {
        if (!providerToSecret.has(provider)) {
            providerToSecret.set(provider, definition.id);
        }
    }
}
export function getSecretDefinition(id) {
    return EXTENSION_SECRET_DEFINITIONS.find((entry) => entry.id === id);
}
export function resolveSecretForProvider(providerId) {
    if (!providerId) {
        return undefined;
    }
    const normalized = providerId.toLowerCase();
    return providerToSecret.get(normalized);
}
//# sourceMappingURL=extensionSecrets.js.map