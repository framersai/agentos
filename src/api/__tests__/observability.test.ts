import { describe, expect, it, vi } from 'vitest';

import { attachUsageAttributes, toTurnMetricUsage } from '../observability.js';

describe('api observability helpers', () => {
  it('maps usage into turn metrics shape with cost support', () => {
    expect(
      toTurnMetricUsage({
        promptTokens: 12,
        completionTokens: 5,
        totalTokens: 17,
        costUSD: 0.004,
      }),
    ).toEqual({
      promptTokens: 12,
      completionTokens: 5,
      totalTokens: 17,
      totalCostUSD: 0.004,
    });
  });

  it('attaches usage attributes to a span', () => {
    const setAttribute = vi.fn();
    attachUsageAttributes(
      { setAttribute } as any,
      {
        promptTokens: 10,
        completionTokens: 4,
        totalTokens: 14,
        totalCostUSD: 0.0025,
      },
    );

    expect(setAttribute).toHaveBeenCalledWith('llm.usage.prompt_tokens', 10);
    expect(setAttribute).toHaveBeenCalledWith('llm.usage.completion_tokens', 4);
    expect(setAttribute).toHaveBeenCalledWith('llm.usage.total_tokens', 14);
    expect(setAttribute).toHaveBeenCalledWith('llm.usage.cost_usd', 0.0025);
  });
});
