import secretCatalog from './extension-secrets.json' with { type: 'json' };

export interface ExtensionSecretDefinition {
  id: string;
  label: string;
  description?: string;
  envVar?: string;
  docsUrl?: string;
  optional?: boolean;
  providers?: string[];
}

export const EXTENSION_SECRET_DEFINITIONS = secretCatalog as ExtensionSecretDefinition[];

const providerToSecret = new Map<string, string>();
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

export function getSecretDefinition(id: string): ExtensionSecretDefinition | undefined {
  return EXTENSION_SECRET_DEFINITIONS.find((entry) => entry.id === id);
}

export function resolveSecretForProvider(providerId?: string): string | undefined {
  if (!providerId) {
    return undefined;
  }
  const normalized = providerId.toLowerCase();
  return providerToSecret.get(normalized);
}
