import { ITranslationProvider, TranslationOptions, TranslationResult } from '../interfaces';
interface DeepLProviderParams {
    apiKey: string;
    endpoint?: string;
}
export declare class DeepLTranslationProvider implements ITranslationProvider {
    readonly id: string;
    isInitialized: boolean;
    private params;
    constructor(id: string, params: DeepLProviderParams);
    initialize(): Promise<void>;
    translate(input: string, source: string, target: string, _options?: TranslationOptions): Promise<TranslationResult>;
    shutdown(): Promise<void>;
}
export {};
//# sourceMappingURL=DeepLTranslationProvider.d.ts.map