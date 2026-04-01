import { ILanguageDetectionProvider, DetectedLanguageResult } from '../interfaces';
interface WhisperParams {
    apiKey?: string;
    endpoint?: string;
}
export declare class WhisperDetectionProvider implements ILanguageDetectionProvider {
    readonly id: string;
    private params;
    isInitialized: boolean;
    constructor(id: string, params: WhisperParams);
    initialize(): Promise<void>;
    detect(_text: string): Promise<DetectedLanguageResult[]>;
    shutdown(): Promise<void>;
}
export {};
//# sourceMappingURL=WhisperDetectionProvider.d.ts.map