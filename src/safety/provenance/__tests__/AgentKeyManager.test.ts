/**
 * @file AgentKeyManager.test.ts
 * @description Tests for Ed25519 key management, signing, and verification.
 */

import { describe, it, expect } from 'vitest';
import { AgentKeyManager } from '../crypto/AgentKeyManager.js';

describe('AgentKeyManager', () => {
  describe('generate', () => {
    it('should generate a new key pair', async () => {
      const km = await AgentKeyManager.generate('test-agent');
      expect(km.getPublicKeyBase64()).toBeTruthy();
      expect(km.getPrivateKeyBase64()).toBeTruthy();
    });

    it('should generate unique keys each time', async () => {
      const km1 = await AgentKeyManager.generate('agent-1');
      const km2 = await AgentKeyManager.generate('agent-2');
      expect(km1.getPublicKeyBase64()).not.toBe(km2.getPublicKeyBase64());
    });
  });

  describe('fromKeySource', () => {
    it('should import keys from a key source', async () => {
      const original = await AgentKeyManager.generate('test-agent');
      const keySource = original.toKeySource();

      const imported = await AgentKeyManager.fromKeySource('test-agent', keySource);
      expect(imported.getPublicKeyBase64()).toBe(original.getPublicKeyBase64());
    });

    it('should generate when key source type is generate', async () => {
      const km = await AgentKeyManager.fromKeySource('test-agent', { type: 'generate' });
      expect(km.getPublicKeyBase64()).toBeTruthy();
    });

    it('should throw if import keys are missing', async () => {
      await expect(
        AgentKeyManager.fromKeySource('test-agent', { type: 'import' }),
      ).rejects.toThrow();
    });
  });

  describe('sign and verify', () => {
    it('should sign data and verify the signature', async () => {
      const km = await AgentKeyManager.generate('test-agent');
      const data = 'Hello, provenance!';
      const signature = await km.sign(data);

      expect(signature).toBeTruthy();
      expect(typeof signature).toBe('string');

      const isValid = await km.verify(data, signature);
      expect(isValid).toBe(true);
    });

    it('should reject invalid signatures', async () => {
      const km = await AgentKeyManager.generate('test-agent');
      const signature = await km.sign('original data');

      const isValid = await km.verify('tampered data', signature);
      expect(isValid).toBe(false);
    });

    it('should reject signatures from different keys', async () => {
      const km1 = await AgentKeyManager.generate('agent-1');
      const km2 = await AgentKeyManager.generate('agent-2');
      const data = 'test data';

      const signature = await km1.sign(data);
      const isValid = await km2.verify(data, signature);
      expect(isValid).toBe(false);
    });
  });

  describe('verifySignature (static)', () => {
    it('should verify with a public key base64', async () => {
      const km = await AgentKeyManager.generate('test-agent');
      const data = 'verify me';
      const signature = await km.sign(data);
      const pubKey = km.getPublicKeyBase64();

      const isValid = await AgentKeyManager.verifySignature(data, signature, pubKey);
      expect(isValid).toBe(true);
    });

    it('should reject tampered data', async () => {
      const km = await AgentKeyManager.generate('test-agent');
      const signature = await km.sign('original');
      const pubKey = km.getPublicKeyBase64();

      const isValid = await AgentKeyManager.verifySignature('tampered', signature, pubKey);
      expect(isValid).toBe(false);
    });
  });

  describe('toKeySource', () => {
    it('should export key source with import type', async () => {
      const km = await AgentKeyManager.generate('test-agent');
      const source = km.toKeySource();

      expect(source.type).toBe('import');
      expect(source.publicKeyBase64).toBe(km.getPublicKeyBase64());
      expect(source.privateKeyBase64).toBe(km.getPrivateKeyBase64());
    });

    it('should roundtrip through toKeySource and fromKeySource', async () => {
      const km = await AgentKeyManager.generate('test-agent');
      const data = 'roundtrip test';
      const signature = await km.sign(data);

      const restored = await AgentKeyManager.fromKeySource('test-agent', km.toKeySource());
      const isValid = await restored.verify(data, signature);
      expect(isValid).toBe(true);
    });
  });
});
