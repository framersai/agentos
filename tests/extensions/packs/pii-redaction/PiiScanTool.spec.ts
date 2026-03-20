/**
 * @file PiiScanTool.spec.ts
 * @description Unit tests for the {@link PiiScanTool}.
 *
 * Tests verify:
 * - Successful scan returning detected entities
 * - Clean text returns empty entity list
 * - Entity type filtering via the `entityTypes` argument
 * - Error handling for missing/invalid text argument
 * - Tool metadata (id, name, category, etc.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PiiScanTool } from '../../../../src/extensions/packs/pii-redaction/tools/PiiScanTool';
import { SharedServiceRegistry } from '../../../../src/extensions/SharedServiceRegistry';
import type { ToolExecutionContext } from '../../../../src/core/tools/ITool';
import type { PiiEntity, PiiDetectionResult } from '../../../../src/extensions/packs/pii-redaction/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock(
  '../../../../src/extensions/packs/pii-redaction/PiiDetectionPipeline',
  () => {
    return {
      PiiDetectionPipeline: vi.fn().mockImplementation(() => ({
        detect: vi.fn().mockResolvedValue({
          entities: [],
          inputLength: 0,
          processingTimeMs: 1,
          tiersExecuted: ['regex'],
          summary: 'No PII detected',
        }),
      })),
    };
  },
);

import { PiiDetectionPipeline } from '../../../../src/extensions/packs/pii-redaction/PiiDetectionPipeline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal execution context for tool calls. */
const CONTEXT: ToolExecutionContext = {
  gmiId: 'gmi-1',
  personaId: 'p1',
  userContext: { userId: 'u1' } as any,
};

/** Sample email entity. */
const EMAIL_ENTITY: PiiEntity = {
  entityType: 'EMAIL',
  text: 'john@example.com',
  start: 0,
  end: 16,
  score: 1.0,
  source: 'regex',
};

/** Sample phone entity. */
const PHONE_ENTITY: PiiEntity = {
  entityType: 'PHONE',
  text: '555-123-4567',
  start: 20,
  end: 32,
  score: 0.9,
  source: 'regex',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PiiScanTool', () => {
  let services: SharedServiceRegistry;
  let tool: PiiScanTool;

  beforeEach(() => {
    services = new SharedServiceRegistry();
    vi.clearAllMocks();
    tool = new PiiScanTool(services, {});
  });

  describe('metadata', () => {
    it('should have correct id, name, and category', () => {
      expect(tool.id).toBe('pii_scan');
      expect(tool.name).toBe('pii_scan');
      expect(tool.displayName).toBe('PII Scanner');
      expect(tool.category).toBe('security');
      expect(tool.hasSideEffects).toBe(false);
    });

    it('should have an input schema requiring "text"', () => {
      expect(tool.inputSchema.required).toContain('text');
      expect(tool.inputSchema.properties.text.type).toBe('string');
    });
  });

  describe('execute', () => {
    it('should return detected entities on success', async () => {
      const mockPipeline = (PiiDetectionPipeline as any).mock.results[
        (PiiDetectionPipeline as any).mock.results.length - 1
      ].value;

      const expectedResult: PiiDetectionResult = {
        entities: [EMAIL_ENTITY, PHONE_ENTITY],
        inputLength: 40,
        processingTimeMs: 5,
        tiersExecuted: ['regex'],
        summary: '2 entities found: 1xEMAIL, 1xPHONE',
      };

      mockPipeline.detect.mockResolvedValueOnce(expectedResult);

      const result = await tool.execute(
        { text: 'john@example.com and 555-123-4567' },
        CONTEXT,
      );

      expect(result.success).toBe(true);
      expect(result.output?.entities).toHaveLength(2);
      expect(result.output?.entities[0].entityType).toBe('EMAIL');
      expect(result.output?.entities[1].entityType).toBe('PHONE');
    });

    it('should return empty entities for clean text', async () => {
      const result = await tool.execute(
        { text: 'Hello world, nothing sensitive here' },
        CONTEXT,
      );

      expect(result.success).toBe(true);
      expect(result.output?.entities).toHaveLength(0);
    });

    it('should filter entities by entityTypes when provided', async () => {
      const mockPipeline = (PiiDetectionPipeline as any).mock.results[
        (PiiDetectionPipeline as any).mock.results.length - 1
      ].value;

      mockPipeline.detect.mockResolvedValueOnce({
        entities: [EMAIL_ENTITY, PHONE_ENTITY],
        inputLength: 40,
        processingTimeMs: 3,
        tiersExecuted: ['regex'],
        summary: '2 entities found: 1xEMAIL, 1xPHONE',
      });

      // Request only EMAIL entities.
      const result = await tool.execute(
        { text: 'john@example.com and 555-123-4567', entityTypes: ['EMAIL'] },
        CONTEXT,
      );

      expect(result.success).toBe(true);
      expect(result.output?.entities).toHaveLength(1);
      expect(result.output?.entities[0].entityType).toBe('EMAIL');
    });

    it('should return error for missing text argument', async () => {
      const result = await tool.execute(
        { text: '' } as any,
        CONTEXT,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle pipeline errors gracefully', async () => {
      const mockPipeline = (PiiDetectionPipeline as any).mock.results[
        (PiiDetectionPipeline as any).mock.results.length - 1
      ].value;

      mockPipeline.detect.mockRejectedValueOnce(new Error('NER model failed'));

      const result = await tool.execute(
        { text: 'Some text to scan' },
        CONTEXT,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('NER model failed');
    });
  });
});
