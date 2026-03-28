/**
 * @file ChainVerifier.test.ts
 * @description Tests for hash chain verification.
 */

import { describe, it, expect } from 'vitest';
import { ChainVerifier } from '../verification/ChainVerifier.js';
import { AgentKeyManager } from '../crypto/AgentKeyManager.js';
import { HashChain } from '../crypto/HashChain.js';
import type { SignedEvent } from '../types.js';

async function buildChain(count: number, keyManager?: AgentKeyManager): Promise<SignedEvent[]> {
  const km = keyManager || await AgentKeyManager.generate('test-agent');
  const chain = new HashChain();
  const events: SignedEvent[] = [];

  for (let i = 0; i < count; i++) {
    const { sequence, prevHash } = chain.advance();
    const payload = { index: i, message: `Event ${i}` };
    const payloadHash = HashChain.computePayloadHash(payload);
    const timestamp = new Date(Date.now() + i * 1000).toISOString();

    const hash = HashChain.computeEventHash({
      sequence,
      type: 'message.created',
      timestamp,
      agentId: 'test-agent',
      prevHash,
      payloadHash,
    });

    const signature = await km.sign(hash);
    chain.recordHash(hash);

    events.push({
      id: `evt-${i}`,
      type: 'message.created',
      timestamp,
      sequence,
      agentId: 'test-agent',
      prevHash,
      hash,
      payloadHash,
      payload,
      signature,
      signerPublicKey: km.getPublicKeyBase64(),
    });
  }

  return events;
}

describe('ChainVerifier', () => {
  describe('verify', () => {
    it('should verify a valid chain', async () => {
      const events = await buildChain(5);
      const result = await ChainVerifier.verify(events);

      expect(result.valid).toBe(true);
      expect(result.eventsVerified).toBe(5);
      expect(result.errors).toHaveLength(0);
    });

    it('should verify empty chain', async () => {
      const result = await ChainVerifier.verify([]);
      expect(result.valid).toBe(true);
      expect(result.eventsVerified).toBe(0);
      expect(result.warnings).toContain('Empty event chain provided.');
    });

    it('should detect sequence gaps', async () => {
      const events = await buildChain(3);
      events[1] = { ...events[1], sequence: 5 }; // Gap

      const result = await ChainVerifier.verify(events);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'SEQUENCE_GAP')).toBe(true);
    });

    it('should detect broken hash chain', async () => {
      const events = await buildChain(3);
      events[1] = { ...events[1], prevHash: 'tampered' };

      const result = await ChainVerifier.verify(events);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'HASH_CHAIN_BROKEN')).toBe(true);
    });

    it('should detect payload hash tampering', async () => {
      const events = await buildChain(3);
      events[1] = { ...events[1], payloadHash: 'tampered_payload_hash' };

      const result = await ChainVerifier.verify(events);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'PAYLOAD_HASH_MISMATCH')).toBe(true);
    });

    it('should detect event hash tampering', async () => {
      const events = await buildChain(3);
      events[0] = { ...events[0], hash: 'tampered_event_hash' };

      const result = await ChainVerifier.verify(events);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'EVENT_HASH_MISMATCH')).toBe(true);
    });

    it('should detect invalid signatures', async () => {
      const events = await buildChain(3);
      events[1] = { ...events[1], signature: 'invalid_signature' };

      const result = await ChainVerifier.verify(events);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'SIGNATURE_INVALID')).toBe(true);
    });

    it('should detect timestamp regression', async () => {
      const events = await buildChain(3);
      events[2] = { ...events[2], timestamp: '2020-01-01T00:00:00.000Z' };

      const result = await ChainVerifier.verify(events);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'TIMESTAMP_REGRESSION')).toBe(true);
    });

    it('should verify with explicit public key', async () => {
      const km = await AgentKeyManager.generate('test-agent');
      const events = await buildChain(3, km);
      const result = await ChainVerifier.verify(events, km.getPublicKeyBase64());
      expect(result.valid).toBe(true);
    });

    it('should warn about partial chain', async () => {
      const events = await buildChain(3);
      events[0] = { ...events[0], sequence: 5 };

      const result = await ChainVerifier.verify(events);
      expect(result.warnings.some(w => w.includes('does not start at sequence 1'))).toBe(true);
    });
  });

  describe('isValid', () => {
    it('should return true for valid chain', async () => {
      const events = await buildChain(3);
      expect(await ChainVerifier.isValid(events)).toBe(true);
    });

    it('should return false for invalid chain', async () => {
      const events = await buildChain(3);
      events[1] = { ...events[1], hash: 'tampered' };
      expect(await ChainVerifier.isValid(events)).toBe(false);
    });
  });

  describe('verifySubChain', () => {
    it('should verify sub-chain with matching start hash', async () => {
      const events = await buildChain(5);
      const subChain = events.slice(2);

      const result = await ChainVerifier.verifySubChain(
        subChain,
        events[1].hash,
      );
      expect(result.valid).toBe(true);
    });

    it('should detect disconnected sub-chain', async () => {
      const events = await buildChain(5);
      const subChain = events.slice(2);

      const result = await ChainVerifier.verifySubChain(
        subChain,
        'wrong_hash',
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'HASH_CHAIN_BROKEN')).toBe(true);
    });
  });
});
