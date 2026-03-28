/**
 * @file SignedEventLedger.test.ts
 * @description Tests for the append-only signed event ledger.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignedEventLedger } from '../ledger/SignedEventLedger.js';
import { AgentKeyManager } from '../crypto/AgentKeyManager.js';
import { HashChain } from '../crypto/HashChain.js';
import type { ProvenanceConfig } from '../types.js';

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => `uuid-${Math.random().toString(36).substring(7)}`),
}));

describe('SignedEventLedger', () => {
  let storageAdapter: any;
  let keyManager: AgentKeyManager;
  let ledger: SignedEventLedger;

  const config: ProvenanceConfig = {
    enabled: true,
    signatureMode: 'every-event',
    hashAlgorithm: 'sha256',
    keySource: { type: 'generate' },
  };

  beforeEach(async () => {
    storageAdapter = {
      run: vi.fn().mockResolvedValue({ changes: 1 }),
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
    };

    keyManager = await AgentKeyManager.generate('agent-1');
    ledger = new SignedEventLedger(storageAdapter, keyManager, 'agent-1', config);
  });

  describe('initialize', () => {
    it('should start with fresh chain when no events exist', async () => {
      storageAdapter.get.mockResolvedValue(null);
      await ledger.initialize();

      const state = ledger.getChainState();
      expect(state.lastHash).toBe('');
      expect(state.sequence).toBe(0);
    });

    it('should resume chain from last event', async () => {
      storageAdapter.get.mockResolvedValue({ sequence: 5, hash: 'prevhash' });
      await ledger.initialize();

      const state = ledger.getChainState();
      expect(state.lastHash).toBe('prevhash');
      expect(state.sequence).toBe(5);
    });
  });

  describe('appendEvent', () => {
    it('should throw if not initialized', async () => {
      await expect(ledger.appendEvent('genesis', {})).rejects.toThrow('not initialized');
    });

    it('should append an event with correct fields', async () => {
      await ledger.initialize();
      const event = await ledger.appendEvent('genesis', { agentId: 'agent-1' });

      expect(event.type).toBe('genesis');
      expect(event.sequence).toBe(1);
      expect(event.agentId).toBe('agent-1');
      expect(event.prevHash).toBe('');
      expect(event.hash).toBeTruthy();
      expect(event.payloadHash).toBeTruthy();
      expect(event.signature).toBeTruthy();
      expect(event.signerPublicKey).toBe(keyManager.getPublicKeyBase64());
    });

    it('should chain hashes correctly', async () => {
      await ledger.initialize();
      const event1 = await ledger.appendEvent('genesis', {});
      const event2 = await ledger.appendEvent('message.created', { text: 'hi' });

      expect(event2.prevHash).toBe(event1.hash);
      expect(event2.sequence).toBe(2);
    });

    it('should persist events to storage', async () => {
      await ledger.initialize();
      await ledger.appendEvent('genesis', {});

      expect(storageAdapter.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining([expect.any(String), 'genesis']),
      );
    });

    it('should skip signing when signatureMode is anchor-only', async () => {
      const anchorConfig: ProvenanceConfig = { ...config, signatureMode: 'anchor-only' };
      const anchorLedger = new SignedEventLedger(storageAdapter, keyManager, 'agent-1', anchorConfig);
      await anchorLedger.initialize();

      const event = await anchorLedger.appendEvent('genesis', {});
      expect(event.signature).toBe('');
    });

    it('should produce valid signatures', async () => {
      await ledger.initialize();
      const event = await ledger.appendEvent('genesis', { test: true });

      const isValid = await keyManager.verify(event.hash, event.signature);
      expect(isValid).toBe(true);
    });

    it('should produce correct payload hash', async () => {
      await ledger.initialize();
      const payload = { message: 'hello', count: 42 };
      const event = await ledger.appendEvent('message.created', payload);

      const expectedPayloadHash = HashChain.computePayloadHash(payload);
      expect(event.payloadHash).toBe(expectedPayloadHash);
    });

    it('should handle concurrent appends sequentially', async () => {
      await ledger.initialize();

      const promises = [
        ledger.appendEvent('message.created', { i: 1 }),
        ledger.appendEvent('message.created', { i: 2 }),
        ledger.appendEvent('message.created', { i: 3 }),
      ];

      const events = await Promise.all(promises);
      expect(events[0].sequence).toBe(1);
      expect(events[1].sequence).toBe(2);
      expect(events[2].sequence).toBe(3);
      expect(events[1].prevHash).toBe(events[0].hash);
      expect(events[2].prevHash).toBe(events[1].hash);
    });
  });

  describe('query methods', () => {
    it('should get event by ID', async () => {
      storageAdapter.get.mockResolvedValueOnce(null); // initialize
      await ledger.initialize();

      storageAdapter.get.mockResolvedValueOnce({
        id: 'evt-1',
        type: 'genesis',
        timestamp: '2025-01-01T00:00:00.000Z',
        sequence: 1,
        agent_id: 'agent-1',
        prev_hash: '',
        hash: 'hash1',
        payload_hash: 'ph1',
        payload: '{}',
        signature: 'sig1',
        signer_public_key: 'pk1',
        anchor_id: null,
      });

      const event = await ledger.getEvent('evt-1');
      expect(event).toBeTruthy();
      expect(event!.id).toBe('evt-1');
      expect(event!.type).toBe('genesis');
    });

    it('should get events by range', async () => {
      storageAdapter.get.mockResolvedValueOnce(null);
      await ledger.initialize();

      storageAdapter.all.mockResolvedValueOnce([
        { id: 'e1', type: 'genesis', timestamp: 't1', sequence: 1, agent_id: 'a1', prev_hash: '', hash: 'h1', payload_hash: 'ph1', payload: '{}', signature: 's1', signer_public_key: 'pk1' },
        { id: 'e2', type: 'message.created', timestamp: 't2', sequence: 2, agent_id: 'a1', prev_hash: 'h1', hash: 'h2', payload_hash: 'ph2', payload: '{}', signature: 's2', signer_public_key: 'pk1' },
      ]);

      const events = await ledger.getEventsByRange(1, 2);
      expect(events).toHaveLength(2);
      expect(events[0].sequence).toBe(1);
      expect(events[1].sequence).toBe(2);
    });

    it('should get event count', async () => {
      storageAdapter.get.mockResolvedValueOnce(null);
      await ledger.initialize();

      storageAdapter.get.mockResolvedValueOnce({ count: 42 });
      const count = await ledger.getEventCount();
      expect(count).toBe(42);
    });

    it('should return 0 count when no events', async () => {
      storageAdapter.get.mockResolvedValueOnce(null);
      await ledger.initialize();

      storageAdapter.get.mockResolvedValueOnce(null);
      const count = await ledger.getEventCount();
      expect(count).toBe(0);
    });
  });

  describe('getChainState', () => {
    it('should reflect current chain state', async () => {
      await ledger.initialize();
      const event = await ledger.appendEvent('genesis', {});

      const state = ledger.getChainState();
      expect(state.lastHash).toBe(event.hash);
      expect(state.sequence).toBe(1);
    });
  });
});
