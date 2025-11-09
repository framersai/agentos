import { describe, it, expect } from 'vitest';
import { normalizeUsage, snapshotPersonaDetails } from '../../src/core/orchestration/helpers';
import type { CostAggregator } from '../../src/cognitive_substrate/IGMI';
import type { IPersonaDefinition } from '../../src/cognitive_substrate/personas/IPersonaDefinition';

describe('orchestration helpers', () => {
  describe('normalizeUsage', () => {
    it('returns undefined when usage is not provided', () => {
      expect(normalizeUsage(undefined)).toBeUndefined();
    });

    it('fills missing fields with zero', () => {
      const rawUsage: Partial<CostAggregator> = {
        completionTokens: 12,
        totalCostUSD: 1.23,
      };

      const normalized = normalizeUsage(rawUsage as CostAggregator)!;

      expect(normalized.totalTokens).toBe(0);
      expect(normalized.promptTokens).toBe(0);
      expect(normalized.completionTokens).toBe(12);
      expect(normalized.totalCostUSD).toBe(1.23);
    });
  });

  describe('snapshotPersonaDetails', () => {
    const basePersona: IPersonaDefinition = {
      id: 'persona-1',
      name: 'Atlas',
      description: 'Systems architect',
      label: 'Atlas Original',
      version: '1.0',
      prompts: [],
      contextualPromptElements: [],
      capabilities: [],
      defaultToolsetIds: [],
      defaultWorkingMemoryConfig: {
        type: 'in_memory',
      },
    };

    it('returns undefined when persona is missing', () => {
      expect(snapshotPersonaDetails(undefined)).toBeUndefined();
    });

    it('returns lightweight snapshot with existing label', () => {
      const snapshot = snapshotPersonaDetails(basePersona)!;
      expect(snapshot).toMatchObject({
        id: 'persona-1',
        label: 'Atlas Original',
        name: 'Atlas',
        version: '1.0',
      });
    });

    it('falls back to displayName, name, then id when label is missing', () => {
      const personaWithoutLabel = { ...basePersona, label: undefined } as IPersonaDefinition;

      const withDisplayName = { ...personaWithoutLabel, name: undefined } as IPersonaDefinition & { displayName?: string };
      withDisplayName.displayName = 'Display Fallback';

      const snapshotDisplay = snapshotPersonaDetails(withDisplayName as unknown as IPersonaDefinition);
      expect(snapshotDisplay?.label).toBe('Display Fallback');

      const snapshotName = snapshotPersonaDetails(personaWithoutLabel);
      expect(snapshotName?.label).toBe('Atlas');

      const withoutName = { ...personaWithoutLabel, name: undefined } as IPersonaDefinition;
      const snapshotId = snapshotPersonaDetails(withoutName);
      expect(snapshotId?.label).toBe('persona-1');
    });
  });
});
