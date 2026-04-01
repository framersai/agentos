import type { Span } from '@opentelemetry/api';
export interface ApiUsageLike {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUSD?: number;
    totalCostUSD?: number;
}
export declare function attachUsageAttributes(span: Span | null, usage?: ApiUsageLike | null): void;
export declare function toTurnMetricUsage(usage?: ApiUsageLike | null): {
    totalTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalCostUSD?: number;
} | undefined;
//# sourceMappingURL=observability.d.ts.map