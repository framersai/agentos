import { describe, it, expect } from 'vitest';
import {
  ALL_PII_ENTITY_TYPES,
  PII_SERVICE_IDS,
  type PiiEntity,
} from '../../../../src/extensions/packs/pii-redaction/types';

describe('PII types', () => {
  it('ALL_PII_ENTITY_TYPES contains all 18 entity types', () => {
    expect(ALL_PII_ENTITY_TYPES).toHaveLength(18);
    expect(ALL_PII_ENTITY_TYPES).toContain('SSN');
    expect(ALL_PII_ENTITY_TYPES).toContain('PERSON');
    expect(ALL_PII_ENTITY_TYPES).toContain('UNKNOWN_PII');
  });

  it('PII_SERVICE_IDS follow agentos:<domain>:<name> convention', () => {
    for (const id of Object.values(PII_SERVICE_IDS)) {
      expect(id).toMatch(/^agentos:[a-z]+:[a-z-]+$/);
    }
  });

  it('PiiEntity satisfies the interface shape', () => {
    const entity: PiiEntity = {
      entityType: 'EMAIL',
      text: 'test@example.com',
      start: 0,
      end: 16,
      score: 1.0,
      source: 'regex',
    };
    expect(entity.entityType).toBe('EMAIL');
    expect(entity.score).toBe(1.0);
  });
});
