/**
 * @file PolicyProfiles.test.ts
 * @description Tests for PolicyProfiles preset configurations.
 */

import { describe, it, expect } from 'vitest';
import { profiles } from '../../../src/core/provenance/config/PolicyProfiles.js';

describe('PolicyProfiles', () => {
  describe('mutableDev', () => {
    it('should have mutable storage, provenance disabled, all human actions allowed', () => {
      const config = profiles.mutableDev();

      expect(config.storagePolicy.mode).toBe('mutable');
      expect(config.provenance.enabled).toBe(false);
      expect(config.autonomy.allowHumanPrompting).toBe(true);
      expect(config.autonomy.allowConfigEdits).toBe(true);
      expect(config.autonomy.allowToolChanges).toBe(true);
    });
  });

  describe('revisionedVerified', () => {
    it('should have revisioned storage, provenance enabled with every-event signing, all human actions allowed', () => {
      const config = profiles.revisionedVerified();

      expect(config.storagePolicy.mode).toBe('revisioned');
      expect(config.provenance.enabled).toBe(true);
      expect(config.provenance.signatureMode).toBe('every-event');
      expect(config.autonomy.allowHumanPrompting).toBe(true);
      expect(config.autonomy.allowConfigEdits).toBe(true);
      expect(config.autonomy.allowToolChanges).toBe(true);
    });
  });

  describe('sealedAutonomous', () => {
    it('should have sealed storage, provenance enabled, no human prompting, no config edits, no tool changes', () => {
      const config = profiles.sealedAutonomous();

      expect(config.storagePolicy.mode).toBe('sealed');
      expect(config.provenance.enabled).toBe(true);
      expect(config.autonomy.allowHumanPrompting).toBe(false);
      expect(config.autonomy.allowConfigEdits).toBe(false);
      expect(config.autonomy.allowToolChanges).toBe(false);
    });

    it('should include pause, stop, and approve_gated_action in allowedHumanActions', () => {
      const config = profiles.sealedAutonomous();

      expect(config.autonomy.allowedHumanActions).toContain('pause');
      expect(config.autonomy.allowedHumanActions).toContain('stop');
      expect(config.autonomy.allowedHumanActions).toContain('approve_gated_action');
    });
  });

  describe('sealedAuditable', () => {
    it('should extend sealedAutonomous with rekor anchor target', () => {
      const config = profiles.sealedAuditable();

      // Inherits sealed autonomous properties
      expect(config.storagePolicy.mode).toBe('sealed');
      expect(config.autonomy.allowHumanPrompting).toBe(false);
      expect(config.autonomy.allowConfigEdits).toBe(false);
      expect(config.autonomy.allowToolChanges).toBe(false);

      // Adds rekor anchor target
      expect(config.provenance.anchorTarget).toBeDefined();
      expect(config.provenance.anchorTarget!.type).toBe('rekor');
      expect(config.provenance.anchorTarget!.endpoint).toBe('https://rekor.sigstore.dev');
    });

    it('should accept a custom rekor endpoint', () => {
      const config = profiles.sealedAuditable('https://custom-rekor.example.com');

      expect(config.provenance.anchorTarget!.endpoint).toBe('https://custom-rekor.example.com');
      expect(config.provenance.anchorTarget!.options).toEqual({
        serverUrl: 'https://custom-rekor.example.com',
      });
    });
  });

  describe('custom', () => {
    it('should merge base and overrides correctly', () => {
      const base = profiles.mutableDev();
      const config = profiles.custom(base, {
        anchorIntervalMs: 60_000,
        anchorBatchSize: 50,
      });

      // Overridden values
      expect(config.anchorIntervalMs).toBe(60_000);
      expect(config.anchorBatchSize).toBe(50);

      // Base values preserved
      expect(config.storagePolicy.mode).toBe('mutable');
      expect(config.provenance.enabled).toBe(false);
      expect(config.autonomy.allowHumanPrompting).toBe(true);
    });

    it('should deep-merge storagePolicy, provenance, and autonomy', () => {
      const base = profiles.mutableDev();
      const config = profiles.custom(base, {
        storagePolicy: {
          mode: 'sealed',
          protectedTables: ['conversations'],
        },
        provenance: {
          enabled: true,
          signatureMode: 'every-event',
          hashAlgorithm: 'sha256',
          keySource: { type: 'generate' },
        },
        autonomy: {
          allowHumanPrompting: false,
          allowConfigEdits: false,
          allowToolChanges: false,
          allowedHumanActions: ['pause'],
        },
      });

      // storagePolicy deep-merged
      expect(config.storagePolicy.mode).toBe('sealed');
      expect(config.storagePolicy.protectedTables).toEqual(['conversations']);

      // provenance deep-merged
      expect(config.provenance.enabled).toBe(true);
      expect(config.provenance.signatureMode).toBe('every-event');

      // autonomy deep-merged
      expect(config.autonomy.allowHumanPrompting).toBe(false);
      expect(config.autonomy.allowConfigEdits).toBe(false);
      expect(config.autonomy.allowToolChanges).toBe(false);
      expect(config.autonomy.allowedHumanActions).toEqual(['pause']);
    });
  });
});
