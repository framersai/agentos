export interface ExtensionSecretDefinition {
    id: string;
    label: string;
    description?: string;
    envVar?: string;
    docsUrl?: string;
    optional?: boolean;
    providers?: string[];
}
export declare const EXTENSION_SECRET_DEFINITIONS: ExtensionSecretDefinition[];
export declare function getSecretDefinition(id: string): ExtensionSecretDefinition | undefined;
export declare function resolveSecretForProvider(providerId?: string): string | undefined;
//# sourceMappingURL=extensionSecrets.d.ts.map