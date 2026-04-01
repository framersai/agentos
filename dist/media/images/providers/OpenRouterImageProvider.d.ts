import { type IImageProvider, type ImageGenerationRequest, type ImageGenerationResult, type ImageModelInfo } from '../IImageProvider.js';
export interface OpenRouterImageProviderConfig {
    apiKey: string;
    baseURL?: string;
    defaultModelId?: string;
    siteUrl?: string;
    appName?: string;
}
export declare class OpenRouterImageProvider implements IImageProvider {
    readonly providerId = "openrouter";
    isInitialized: boolean;
    defaultModelId?: string;
    private config;
    initialize(config: Record<string, unknown>): Promise<void>;
    generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
    listAvailableModels(): Promise<ImageModelInfo[]>;
}
//# sourceMappingURL=OpenRouterImageProvider.d.ts.map