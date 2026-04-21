import { describe, it, expect, beforeEach } from 'vitest';
import {
  createUncensoredModelCatalog,
  type UncensoredModelCatalog,
} from '../UncensoredModelCatalog';

describe('UncensoredModelCatalog', () => {
  let catalog: UncensoredModelCatalog;

  beforeEach(() => {
    catalog = createUncensoredModelCatalog();
  });

  // -------------------------------------------------------------------------
  // getTextModels
  // -------------------------------------------------------------------------

  describe('getTextModels', () => {
    it('returns all live text models with no filter', () => {
      // Current catalog: hermes-3-405b, hermes-3-70b. Dolphin
      // Mixtral / Dolphin 3.0 / MythoMax were all removed — see the
      // TEXT_MODELS comments for each removal's rationale.
      const models = catalog.getTextModels();
      expect(models).toHaveLength(2);
      expect(models.every((m) => m.modality === 'text')).toBe(true);
      expect(models.every((m) => m.providerId === 'openrouter')).toBe(true);
    });

    it('filters by quality', () => {
      // Both remaining entries (hermes-405b, hermes-70b) are `high`.
      const high = catalog.getTextModels({ quality: 'high' });
      expect(high).toHaveLength(2);
      expect(high.every((m) => m.quality === 'high')).toBe(true);

      // Low-tier entries were removed; the filter still works but
      // returns nothing.
      const low = catalog.getTextModels({ quality: 'low' });
      expect(low).toHaveLength(0);
    });

    it('filters by contentPermissions', () => {
      const erotic = catalog.getTextModels({
        contentPermissions: ['erotic'],
      });
      // Every curated text entry currently permits erotic content;
      // the catalog exists precisely to route mature/private-adult
      // traffic off the default censored chain.
      expect(erotic).toHaveLength(2);
      expect(erotic.every((m) => m.contentPermissions.includes('erotic'))).toBe(
        true,
      );
    });

    it('filters by quality + contentPermissions together', () => {
      const highErotic = catalog.getTextModels({
        quality: 'high',
        contentPermissions: ['erotic'],
      });
      expect(highErotic).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // getImageModels
  // -------------------------------------------------------------------------

  describe('getImageModels', () => {
    it('returns all 6 image models with no filter', () => {
      const models = catalog.getImageModels();
      expect(models).toHaveLength(6);
      expect(models.every((m) => m.modality === 'image')).toBe(true);
      expect(models.every((m) => m.providerId === 'replicate')).toBe(true);
    });

    it('filters by face-consistency capability', () => {
      const faceModels = catalog.getImageModels({
        capabilities: ['face-consistency'],
      });
      expect(faceModels).toHaveLength(2);
      expect(
        faceModels.every((m) => m.capabilities.includes('face-consistency')),
      ).toBe(true);
    });

    it('filters by video capability', () => {
      const videoModels = catalog.getImageModels({
        capabilities: ['video'],
      });
      expect(videoModels).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // getPreferredTextModel
  // -------------------------------------------------------------------------

  describe('getPreferredTextModel', () => {
    it('returns null for safe tier', () => {
      expect(catalog.getPreferredTextModel('safe')).toBeNull();
    });

    it('returns null for standard tier', () => {
      expect(catalog.getPreferredTextModel('standard')).toBeNull();
    });

    it('returns highest-quality model for private-adult tier', () => {
      const model = catalog.getPreferredTextModel('private-adult');
      expect(model).not.toBeNull();
      expect(model!.quality).toBe('high');
      expect(model!.providerId).toBe('openrouter');
    });

    it('returns a model for mature tier', () => {
      const model = catalog.getPreferredTextModel('mature');
      expect(model).not.toBeNull();
      expect(model!.quality).toBe('high');
    });

    it('respects contentIntent — erotic narrows to models with erotic permission', () => {
      const model = catalog.getPreferredTextModel('private-adult', 'erotic');
      expect(model).not.toBeNull();
      expect(model!.contentPermissions).toContain('erotic');
      expect(model!.quality).toBe('high');
    });

    it('respects contentIntent — horror excludes toppy-m-7b', () => {
      const model = catalog.getPreferredTextModel('mature', 'horror');
      expect(model).not.toBeNull();
      expect(model!.contentPermissions).toContain('horror');
      // toppy-m-7b does not support horror, so it should not be selected
      expect(model!.modelId).not.toBe('undi95/toppy-m-7b');
    });
  });

  // -------------------------------------------------------------------------
  // getPreferredImageModel
  // -------------------------------------------------------------------------

  describe('getPreferredImageModel', () => {
    it('returns null for safe tier', () => {
      expect(catalog.getPreferredImageModel('safe')).toBeNull();
    });

    it('returns null for standard tier', () => {
      expect(catalog.getPreferredImageModel('standard')).toBeNull();
    });

    it('returns replicate model for private-adult tier', () => {
      const model = catalog.getPreferredImageModel('private-adult');
      expect(model).not.toBeNull();
      expect(model!.providerId).toBe('replicate');
      expect(model!.quality).toBe('high');
    });

    it('returns replicate model for mature tier', () => {
      const model = catalog.getPreferredImageModel('mature');
      expect(model).not.toBeNull();
      expect(model!.providerId).toBe('replicate');
    });

    it('filters by face-consistency capability', () => {
      const model = catalog.getPreferredImageModel('private-adult', [
        'face-consistency',
      ]);
      expect(model).not.toBeNull();
      expect(model!.capabilities).toContain('face-consistency');
    });

    it('returns null when no models match impossible capability filter', () => {
      const model = catalog.getPreferredImageModel('private-adult', [
        'teleportation',
      ]);
      expect(model).toBeNull();
    });
  });
});
