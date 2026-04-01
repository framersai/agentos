import type { SpeechProviderCatalogEntry, SpeechProviderKind } from './types.js';
export declare const SPEECH_PROVIDER_CATALOG: readonly SpeechProviderCatalogEntry[];
export declare function getSpeechProviderCatalog(kind?: SpeechProviderKind): SpeechProviderCatalogEntry[];
export declare function getSpeechProviderKinds(): SpeechProviderKind[];
export declare function findSpeechProviderCatalogEntry(id: string): SpeechProviderCatalogEntry | undefined;
export declare function isSpeechProviderConfigured(entry: SpeechProviderCatalogEntry, env?: Record<string, string | undefined>): boolean;
//# sourceMappingURL=providerCatalog.d.ts.map