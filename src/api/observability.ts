import type { Span } from '@opentelemetry/api';

export interface ApiUsageLike {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUSD?: number;
  totalCostUSD?: number;
}

export function attachUsageAttributes(span: Span | null, usage?: ApiUsageLike | null): void {
  if (!span || !usage) return;

  if (typeof usage.promptTokens === 'number') {
    span.setAttribute('llm.usage.prompt_tokens', usage.promptTokens);
  }
  if (typeof usage.completionTokens === 'number') {
    span.setAttribute('llm.usage.completion_tokens', usage.completionTokens);
  }
  if (typeof usage.totalTokens === 'number') {
    span.setAttribute('llm.usage.total_tokens', usage.totalTokens);
  }

  const totalCostUSD =
    typeof usage.totalCostUSD === 'number'
      ? usage.totalCostUSD
      : typeof usage.costUSD === 'number'
        ? usage.costUSD
        : undefined;
  if (typeof totalCostUSD === 'number') {
    span.setAttribute('llm.usage.cost_usd', totalCostUSD);
  }
}

export function toTurnMetricUsage(usage?: ApiUsageLike | null): {
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalCostUSD?: number;
} | undefined {
  if (!usage) return undefined;

  const totalTokens = typeof usage.totalTokens === 'number' ? usage.totalTokens : undefined;
  const promptTokens = typeof usage.promptTokens === 'number' ? usage.promptTokens : undefined;
  const completionTokens = typeof usage.completionTokens === 'number' ? usage.completionTokens : undefined;
  const totalCostUSD =
    typeof usage.totalCostUSD === 'number'
      ? usage.totalCostUSD
      : typeof usage.costUSD === 'number'
        ? usage.costUSD
        : undefined;

  if (
    totalTokens === undefined
    && promptTokens === undefined
    && completionTokens === undefined
    && totalCostUSD === undefined
  ) {
    return undefined;
  }

  return {
    totalTokens,
    promptTokens,
    completionTokens,
    totalCostUSD,
  };
}
