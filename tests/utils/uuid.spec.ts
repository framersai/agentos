/**
 * @file uuid.spec.ts
 * @description Unit tests for UUID utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  generateUUID,
  uuidv4,
  generateUniqueId,
} from '../../src/utils/uuid';

describe('UUID Utilities', () => {
  describe('generateUUID', () => {
    it('should generate a valid UUID v4', () => {
      const uuid = generateUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate unique UUIDs', () => {
      const uuids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        uuids.add(generateUUID());
      }
      expect(uuids.size).toBe(100);
    });

    it('should have correct format with dashes', () => {
      const uuid = generateUUID();
      const parts = uuid.split('-');
      expect(parts.length).toBe(5);
      expect(parts[0].length).toBe(8);
      expect(parts[1].length).toBe(4);
      expect(parts[2].length).toBe(4);
      expect(parts[3].length).toBe(4);
      expect(parts[4].length).toBe(12);
    });
  });

  describe('uuidv4 alias', () => {
    it('should be the same as generateUUID', () => {
      expect(uuidv4).toBe(generateUUID);
    });

    it('should generate valid UUID', () => {
      const uuid = uuidv4();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
  });

  describe('generateUniqueId alias', () => {
    it('should be the same as generateUUID', () => {
      expect(generateUniqueId).toBe(generateUUID);
    });

    it('should generate valid UUID', () => {
      const id = generateUniqueId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
  });
});

