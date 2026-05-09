/**
 * @file BundleExporter.test.ts
 * @description Tests for verification bundle export/import and offline verification.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BundleExporter } from '../verification/BundleExporter.js';
import { AgentKeyManager } from '../crypto/AgentKeyManager.js';
import { HashChain } from '../crypto/HashChain.js';
import type { SignedEvent } from '../types.js';

async function buildEvents(count: number, km: AgentKeyManager): Promise<SignedEvent[]> {
  const chain = new HashChain();
  const events: SignedEvent[] = [];

  for (let i = 0; i < count; i++) {
    const { sequence, prevHash } = chain.advance();
    const payload = { i };
    const payloadHash = HashChain.computePayloadHash(payload);
    const timestamp = new Date(Date.now() + i * 1000).toISOString();

    const hash = HashChain.computeEventHash({
      sequence, type: 'message.created', timestamp,
      agentId: 'agent-1', prevHash, payloadHash,
    });

    const signature = await km.sign(hash);
    chain.recordHash(hash);

    events.push({
      id: `evt-${i}`, type: 'message.created', timestamp, sequence,
      agentId: 'agent-1', prevHash, hash, payloadHash,
      payload, signature, signerPublicKey: km.getPublicKeyBase64(),
    });
  }

  return events;
}

describe('BundleExporter', () => {
  let km: AgentKeyManager;
  let events: SignedEvent[];
  let mockLedger: any;
  let mockAnchorStorage: any;

  beforeEach(async () => {
    km = await AgentKeyManager.generate('agent-1');
    events = await buildEvents(5, km);

    mockLedger = {
      getAllEvents: vi.fn().mockResolvedValue(events),
      getEventsByRange: vi.fn().mockImplementation((from: number, to: number) =>
        Promise.resolve(events.filter(e => e.sequence >= from && e.sequence <= to)),
      ),
      getChainState: vi.fn().mockReturnValue({ lastHash: events[4].hash, sequence: 5 }),
    };

    mockAnchorStorage = {
      all: vi.fn().mockResolvedValue([]),
    };
  });

  describe('exportBundle', () => {
    it('should export a bundle with all events', async () => {
      const exporter = new BundleExporter(mockLedger, km, mockAnchorStorage);
      const bundle = await exporter.exportBundle();

      expect(bundle.version).toBe('1.0.0');
      expect(bundle.agentId).toBe('agent-1');
      expect(bundle.publicKey).toBe(km.getPublicKeyBase64());
      expect(bundle.events).toHaveLength(5);
      expect(bundle.bundleHash).toBeTruthy();
      expect(bundle.bundleSignature).toBeTruthy();
    });

    it('should export a bundle for a specific range', async () => {
      const exporter = new BundleExporter(mockLedger, km, mockAnchorStorage);
      const bundle = await exporter.exportBundle(2, 4);

      expect(bundle.events).toHaveLength(3);
      expect(bundle.events[0].sequence).toBe(2);
      expect(bundle.events[2].sequence).toBe(4);
    });

    it('should include anchors in bundle', async () => {
      mockAnchorStorage.all.mockResolvedValueOnce([
        {
          id: 'a1', merkle_root: 'mr1', sequence_from: 1, sequence_to: 3,
          event_count: 3, signature: 'sig1', timestamp: 't1', external_ref: null,
        },
      ]);

      const exporter = new BundleExporter(mockLedger, km, mockAnchorStorage);
      const bundle = await exporter.exportBundle();

      expect(bundle.anchors).toHaveLength(1);
      expect(bundle.anchors[0].merkleRoot).toBe('mr1');
    });
  });

  describe('exportAsJSONL', () => {
    it('should export JSONL with metadata, events, and anchors', async () => {
      const exporter = new BundleExporter(mockLedger, km, mockAnchorStorage);
      const jsonl = await exporter.exportAsJSONL();

      const lines = jsonl.split('\n');
      expect(lines.length).toBe(6); // 1 metadata + 5 events

      const metadata = JSON.parse(lines[0]);
      expect(metadata.type).toBe('metadata');
      expect(metadata.eventCount).toBe(5);

      const firstEvent = JSON.parse(lines[1]);
      expect(firstEvent._line).toBe('event');
      expect(firstEvent.sequence).toBe(1);
    });
  });

  describe('parseJSONL', () => {
    it('should parse JSONL back into a bundle', async () => {
      const exporter = new BundleExporter(mockLedger, km, mockAnchorStorage);
      const jsonl = await exporter.exportAsJSONL();
      const bundle = BundleExporter.parseJSONL(jsonl);

      expect(bundle.events).toHaveLength(5);
      expect(bundle.version).toBe('1.0.0');
      expect(bundle.publicKey).toBe(km.getPublicKeyBase64());
    });

    it('should throw on empty JSONL', () => {
      expect(() => BundleExporter.parseJSONL('')).toThrow('Empty JSONL bundle');
    });

    it('should throw if first line is not metadata', () => {
      expect(() => BundleExporter.parseJSONL('{"type":"event"}')).toThrow('First line must be metadata');
    });
  });

  describe('importAndVerify', () => {
    it('should verify a valid bundle', async () => {
      const exporter = new BundleExporter(mockLedger, km, mockAnchorStorage);
      const bundle = await exporter.exportBundle();
      const result = await BundleExporter.importAndVerify(bundle);

      expect(result.valid).toBe(true);
      expect(result.eventsVerified).toBe(5);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect tampered bundle hash', async () => {
      const exporter = new BundleExporter(mockLedger, km, mockAnchorStorage);
      const bundle = await exporter.exportBundle();
      bundle.bundleHash = 'tampered';

      const result = await BundleExporter.importAndVerify(bundle);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'BUNDLE_HASH_MISMATCH')).toBe(true);
    });

    it('should detect tampered bundle signature', async () => {
      const exporter = new BundleExporter(mockLedger, km, mockAnchorStorage);
      const bundle = await exporter.exportBundle();
      bundle.bundleSignature = 'invalid_sig';

      const result = await BundleExporter.importAndVerify(bundle);
      expect(result.valid).toBe(false);
    });

    it('should roundtrip through JSONL', async () => {
      const exporter = new BundleExporter(mockLedger, km, mockAnchorStorage);
      const jsonl = await exporter.exportAsJSONL();
      const parsed = BundleExporter.parseJSONL(jsonl);
      const result = await BundleExporter.importAndVerify(parsed);

      expect(result.valid).toBe(true);
    });

    it('should detect tampered event in bundle', async () => {
      const exporter = new BundleExporter(mockLedger, km, mockAnchorStorage);
      const bundle = await exporter.exportBundle();
      bundle.events[2].payload = { i: 999 }; // tamper payload

      const result = await BundleExporter.importAndVerify(bundle);
      expect(result.valid).toBe(false);
    });
  });
});
