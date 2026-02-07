/**
 * @file AutonomyGuard.test.ts
 * @description Tests for AutonomyGuard enforcement of autonomy rules in sealed mode.
 */

import { describe, it, expect } from 'vitest';
import { AutonomyGuard } from '../../../src/core/provenance/enforcement/AutonomyGuard.js';
import { ProvenanceViolationError } from '../../../src/core/provenance/types.js';
import type { AutonomyConfig } from '../../../src/core/provenance/types.js';

/**
 * Helper to create a basic sealed (restrictive) autonomy config.
 */
function sealedConfig(overrides?: Partial<AutonomyConfig>): AutonomyConfig {
  return {
    allowHumanPrompting: false,
    allowConfigEdits: false,
    allowToolChanges: false,
    genesisEventId: 'genesis-001',
    ...overrides,
  };
}

describe('AutonomyGuard', () => {
  describe('before genesis', () => {
    it('should allow all human actions', async () => {
      const config: AutonomyConfig = {
        allowHumanPrompting: false,
        allowConfigEdits: false,
        allowToolChanges: false,
        // No genesisEventId => not sealed yet
      };
      const guard = new AutonomyGuard(config, null);

      // All of these should resolve without throwing
      await expect(guard.checkHumanAction('prompt')).resolves.toBeUndefined();
      await expect(guard.checkHumanAction('edit_config')).resolves.toBeUndefined();
      await expect(guard.checkHumanAction('add_tool')).resolves.toBeUndefined();
      await expect(guard.checkHumanAction('user_message')).resolves.toBeUndefined();
      await expect(guard.checkHumanAction('anything_else')).resolves.toBeUndefined();
    });
  });

  describe('after genesis', () => {
    it('should block human prompting when allowHumanPrompting is false', async () => {
      const guard = new AutonomyGuard(sealedConfig(), null);

      await expect(guard.checkHumanAction('prompt')).rejects.toThrow(
        ProvenanceViolationError,
      );
      await expect(guard.checkHumanAction('user_message')).rejects.toThrow(
        ProvenanceViolationError,
      );
      await expect(guard.checkHumanAction('human_input')).rejects.toThrow(
        ProvenanceViolationError,
      );
    });

    it('should block config edits when allowConfigEdits is false', async () => {
      const guard = new AutonomyGuard(sealedConfig(), null);

      await expect(guard.checkHumanAction('edit_config')).rejects.toThrow(
        ProvenanceViolationError,
      );
      await expect(guard.checkHumanAction('config_change')).rejects.toThrow(
        ProvenanceViolationError,
      );
    });

    it('should block tool changes when allowToolChanges is false', async () => {
      const guard = new AutonomyGuard(sealedConfig(), null);

      await expect(guard.checkHumanAction('add_tool')).rejects.toThrow(
        ProvenanceViolationError,
      );
      await expect(guard.checkHumanAction('remove_tool')).rejects.toThrow(
        ProvenanceViolationError,
      );
      await expect(guard.checkHumanAction('tool_change')).rejects.toThrow(
        ProvenanceViolationError,
      );
    });

    it('should allow actions in allowedHumanActions list', async () => {
      const guard = new AutonomyGuard(
        sealedConfig({ allowedHumanActions: ['pause', 'stop', 'approve_gated_action'] }),
        null,
      );

      await expect(guard.checkHumanAction('pause')).resolves.toBeUndefined();
      await expect(guard.checkHumanAction('stop')).resolves.toBeUndefined();
      await expect(guard.checkHumanAction('approve_gated_action')).resolves.toBeUndefined();
    });

    it('should allow pause and stop in sealedAutonomous config', async () => {
      const guard = new AutonomyGuard(
        sealedConfig({ allowedHumanActions: ['pause', 'stop'] }),
        null,
      );

      // These are whitelisted
      await expect(guard.checkHumanAction('pause')).resolves.toBeUndefined();
      await expect(guard.checkHumanAction('stop')).resolves.toBeUndefined();

      // But prompting is still blocked
      await expect(guard.checkHumanAction('prompt')).rejects.toThrow(
        ProvenanceViolationError,
      );
    });
  });

  describe('isSealed', () => {
    it('should return false before genesis', () => {
      const config: AutonomyConfig = {
        allowHumanPrompting: false,
        allowConfigEdits: false,
        allowToolChanges: false,
      };
      const guard = new AutonomyGuard(config, null);

      expect(guard.isSealed()).toBe(false);
    });

    it('should return true after genesis', () => {
      const guard = new AutonomyGuard(sealedConfig(), null);

      expect(guard.isSealed()).toBe(true);
    });
  });

  describe('wouldAllow', () => {
    it('should correctly predict blocked actions', () => {
      const guard = new AutonomyGuard(sealedConfig(), null);

      expect(guard.wouldAllow('prompt')).toBe(false);
      expect(guard.wouldAllow('user_message')).toBe(false);
      expect(guard.wouldAllow('human_input')).toBe(false);
      expect(guard.wouldAllow('edit_config')).toBe(false);
      expect(guard.wouldAllow('config_change')).toBe(false);
      expect(guard.wouldAllow('add_tool')).toBe(false);
      expect(guard.wouldAllow('remove_tool')).toBe(false);
      expect(guard.wouldAllow('tool_change')).toBe(false);
    });

    it('should correctly predict allowed actions', () => {
      const guard = new AutonomyGuard(
        sealedConfig({ allowedHumanActions: ['pause', 'stop'] }),
        null,
      );

      expect(guard.wouldAllow('pause')).toBe(true);
      expect(guard.wouldAllow('stop')).toBe(true);
    });

    it('should return true for all actions before genesis', () => {
      const config: AutonomyConfig = {
        allowHumanPrompting: false,
        allowConfigEdits: false,
        allowToolChanges: false,
      };
      const guard = new AutonomyGuard(config, null);

      expect(guard.wouldAllow('prompt')).toBe(true);
      expect(guard.wouldAllow('edit_config')).toBe(true);
      expect(guard.wouldAllow('add_tool')).toBe(true);
      expect(guard.wouldAllow('anything')).toBe(true);
    });
  });

  describe('unknown action types', () => {
    it('should be blocked by default in sealed mode', async () => {
      const guard = new AutonomyGuard(sealedConfig(), null);

      await expect(guard.checkHumanAction('unknown_action')).rejects.toThrow(
        ProvenanceViolationError,
      );
      await expect(guard.checkHumanAction('custom_action')).rejects.toThrow(
        ProvenanceViolationError,
      );
      await expect(guard.checkHumanAction('arbitrary')).rejects.toThrow(
        ProvenanceViolationError,
      );
    });
  });
});
