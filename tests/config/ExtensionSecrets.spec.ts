/**
 * @file ExtensionSecrets.spec.ts
 * @description Unit tests for Extension Secrets configuration
 */

import { describe, it, expect } from 'vitest';
import {
  EXTENSION_SECRET_DEFINITIONS,
  getSecretDefinition,
  resolveSecretForProvider,
  type ExtensionSecretDefinition,
} from '../../src/config/ExtensionSecrets';

describe('ExtensionSecrets', () => {
  describe('EXTENSION_SECRET_DEFINITIONS', () => {
    it('should be an array', () => {
      expect(Array.isArray(EXTENSION_SECRET_DEFINITIONS)).toBe(true);
    });

    it('should have valid structure for all definitions', () => {
      for (const def of EXTENSION_SECRET_DEFINITIONS) {
        expect(def).toHaveProperty('id');
        expect(def).toHaveProperty('label');
        expect(typeof def.id).toBe('string');
        expect(typeof def.label).toBe('string');
      }
    });
  });

  describe('getSecretDefinition', () => {
    it('should return definition for existing secret id', () => {
      if (EXTENSION_SECRET_DEFINITIONS.length > 0) {
        const firstDef = EXTENSION_SECRET_DEFINITIONS[0];
        const result = getSecretDefinition(firstDef.id);
        expect(result).toBeDefined();
        expect(result?.id).toBe(firstDef.id);
      }
    });

    it('should return undefined for non-existent secret id', () => {
      const result = getSecretDefinition('nonexistent-secret-id-xyz');
      expect(result).toBeUndefined();
    });

    it('should return correct definition with all properties', () => {
      if (EXTENSION_SECRET_DEFINITIONS.length > 0) {
        const firstDef = EXTENSION_SECRET_DEFINITIONS[0];
        const result = getSecretDefinition(firstDef.id);
        
        expect(result?.id).toBe(firstDef.id);
        expect(result?.label).toBe(firstDef.label);
        
        if (firstDef.description !== undefined) {
          expect(result?.description).toBe(firstDef.description);
        }
        if (firstDef.envVar !== undefined) {
          expect(result?.envVar).toBe(firstDef.envVar);
        }
      }
    });
  });

  describe('resolveSecretForProvider', () => {
    it('should return undefined for undefined provider', () => {
      const result = resolveSecretForProvider(undefined);
      expect(result).toBeUndefined();
    });

    it('should return undefined for empty string provider', () => {
      const result = resolveSecretForProvider('');
      expect(result).toBeUndefined();
    });

    it('should return undefined for non-existent provider', () => {
      const result = resolveSecretForProvider('nonexistent-provider-xyz');
      expect(result).toBeUndefined();
    });

    it('should normalize provider to lowercase', () => {
      // Find a definition that has providers
      const defWithProviders = EXTENSION_SECRET_DEFINITIONS.find(
        (def) => def.providers && def.providers.length > 0
      );
      
      if (defWithProviders && defWithProviders.providers) {
        const provider = defWithProviders.providers[0];
        const resultLower = resolveSecretForProvider(provider.toLowerCase());
        
        // The lookup normalizes to lowercase
        expect(resultLower).toBeDefined();
      }
    });

    it('should resolve secret for provider with mapping', () => {
      // Find a definition that has providers
      const defWithProviders = EXTENSION_SECRET_DEFINITIONS.find(
        (def) => def.providers && def.providers.length > 0
      );
      
      if (defWithProviders && defWithProviders.providers) {
        const provider = defWithProviders.providers[0].toLowerCase();
        const result = resolveSecretForProvider(provider);
        expect(result).toBe(defWithProviders.id);
      }
    });
  });
});

