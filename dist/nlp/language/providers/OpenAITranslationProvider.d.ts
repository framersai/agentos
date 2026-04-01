import { ITranslationProvider, TranslationOptions, TranslationResult } from '../interfaces';
interface OpenAIProviderParams {
    apiKey: string;
    model?: string;
    endpoint?: string;
}
export declare class OpenAITranslationProvider implements ITranslationProvider {
    readonly id: string;
    isInitialized: boolean;
    private params;
    constructor(id: string, params: OpenAIProviderParams);
    initialize(): Promise<void>;
    translate(input: string, source: string, target: string, options?: TranslationOptions): Promise<TranslationResult>;
    shutdown(): Promise<void>;
}
export {};
//# sourceMappingURL=OpenAITranslationProvider.d.ts.map