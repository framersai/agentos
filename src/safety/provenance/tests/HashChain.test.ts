/**
 * @file HashChain.test.ts
 * @description Tests for SHA-256 hash chain and canonical JSON utilities.
 */

import { describe, it, expect } from 'vitest';
import { HashChain } from '../crypto/HashChain.js';

describe('HashChain', () => {
  describe('constructor', () => {
    it('should initialize with default values', () => {
      const chain = new HashChain();
      expect(chain.getLastHash()).toBe('');
      expect(chain.getSequence()).toBe(0);
    });

    it('should initialize with provided values', () => {
      const chain = new HashChain('abc123', 5);
      expect(chain.getLastHash()).toBe('abc123');
      expect(chain.getSequence()).toBe(5);
    });
  });

  describe('advance', () => {
    it('should increment sequence and return prev hash', () => {
      const chain = new HashChain('prev', 3);
      const result = chain.advance();
      expect(result.sequence).toBe(4);
      expect(result.prevHash).toBe('prev');
    });

    it('should start from 1 for new chain', () => {
      const chain = new HashChain();
      const result = chain.advance();
      expect(result.sequence).toBe(1);
      expect(result.prevHash).toBe('');
    });
  });

  describe('recordHash', () => {
    it('should update last hash', () => {
      const chain = new HashChain();
      chain.advance();
      chain.recordHash('newhash');
      expect(chain.getLastHash()).toBe('newhash');
    });
  });

  describe('hash', () => {
    it('should produce consistent SHA-256 hashes', () => {
      const hash1 = HashChain.hash('hello');
      const hash2 = HashChain.hash('hello');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // 32 bytes hex
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = HashChain.hash('hello');
      const hash2 = HashChain.hash('world');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('canonicalJSON', () => {
    it('should sort keys alphabetically', () => {
      const result = HashChain.canonicalJSON({ z: 1, a: 2, m: 3 });
      expect(result).toBe('{"a":2,"m":3,"z":1}');
    });

    it('should sort nested object keys', () => {
      const result = HashChain.canonicalJSON({ b: { z: 1, a: 2 }, a: 1 });
      expect(result).toBe('{"a":1,"b":{"a":2,"z":1}}');
    });

    it('should handle arrays without reordering', () => {
      const result = HashChain.canonicalJSON({ items: [3, 1, 2] });
      expect(result).toBe('{"items":[3,1,2]}');
    });

    it('should handle null values', () => {
      const result = HashChain.canonicalJSON({ a: null, b: 1 });
      expect(result).toBe('{"a":null,"b":1}');
    });

    it('should handle empty object', () => {
      const result = HashChain.canonicalJSON({});
      expect(result).toBe('{}');
    });
  });

  describe('computePayloadHash', () => {
    it('should compute deterministic hash of payload', () => {
      const payload = { message: 'hello', count: 1 };
      const hash1 = HashChain.computePayloadHash(payload);
      const hash2 = HashChain.computePayloadHash(payload);
      expect(hash1).toBe(hash2);
    });

    it('should produce same hash regardless of key order', () => {
      const hash1 = HashChain.computePayloadHash({ a: 1, b: 2 });
      const hash2 = HashChain.computePayloadHash({ b: 2, a: 1 });
      expect(hash1).toBe(hash2);
    });
  });

  describe('computeEventHash', () => {
    it('should compute deterministic event hash', () => {
      const params = {
        sequence: 1,
        type: 'genesis' as const,
        timestamp: '2025-01-01T00:00:00.000Z',
        agentId: 'agent-1',
        prevHash: '',
        payloadHash: 'abc123',
      };
      const hash1 = HashChain.computeEventHash(params);
      const hash2 = HashChain.computeEventHash(params);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should produce different hashes for different sequences', () => {
      const base = {
        type: 'genesis' as const,
        timestamp: '2025-01-01T00:00:00.000Z',
        agentId: 'agent-1',
        prevHash: '',
        payloadHash: 'abc123',
      };
      const hash1 = HashChain.computeEventHash({ ...base, sequence: 1 });
      const hash2 = HashChain.computeEventHash({ ...base, sequence: 2 });
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('chain integrity', () => {
    it('should build a verifiable chain of hashes', () => {
      const chain = new HashChain();
      const hashes: string[] = [];

      for (let i = 0; i < 5; i++) {
        const { sequence, prevHash } = chain.advance();
        const hash = HashChain.computeEventHash({
          sequence,
          type: 'message.created',
          timestamp: new Date().toISOString(),
          agentId: 'test',
          prevHash,
          payloadHash: HashChain.computePayloadHash({ i }),
        });
        chain.recordHash(hash);
        hashes.push(hash);
      }

      expect(hashes).toHaveLength(5);
      expect(new Set(hashes).size).toBe(5); // All unique
      expect(chain.getSequence()).toBe(5);
    });
  });
});
