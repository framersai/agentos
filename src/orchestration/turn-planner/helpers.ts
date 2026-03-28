import { CostAggregator } from '../../cognitive_substrate/IGMI';
import type { IPersonaDefinition } from '../../cognitive_substrate/personas/IPersonaDefinition';

/**
 * Normalises undefined cost fields so downstream consumers always receive a fully shaped usage object.
 */
export const normalizeUsage = (usage?: CostAggregator): CostAggregator | undefined => {
  if (!usage) {
    return undefined;
  }

  return {
    totalTokens: usage.totalTokens ?? 0,
    promptTokens: usage.promptTokens ?? 0,
    completionTokens: usage.completionTokens ?? 0,
    totalCostUSD: usage.totalCostUSD,
    breakdown: usage.breakdown,
  };
};

/**
 * Produces a lightweight persona snapshot suitable for metadata streaming.
 * Falls back to label/name display hints if the persona definition omits them.
 */
export const snapshotPersonaDetails = (
  persona?: IPersonaDefinition,
): Partial<IPersonaDefinition> | undefined => {
  if (!persona) {
    return undefined;
  }

  const label =
    persona.label ??
    (persona as unknown as { displayName?: string }).displayName ??
    persona.name ??
    persona.id;

  return {
    id: persona.id,
    name: persona.name,
    description: persona.description,
    version: persona.version,
    label,
  };
};
