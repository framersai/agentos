/**
 * @file PiiRedactTool.spec.ts
 * @description Unit tests for the {@link PiiRedactTool}.
 *
 * Tests verify:
 * - Successful redaction with default placeholder style
 * - Per-call redaction style override
 * - Clean text returns wasRedacted = false
 * - Error handling for missing/invalid text argument
 * - Tool metadata (id, name, category, etc.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PiiRedactTool } from '../../../../src/extensions/packs/pii-redaction/tools/PiiRedactTool';
import { SharedServiceRegistry } from '../../../../src/extensions/SharedServiceRegistry';
import type { ToolExecutionContext } from '../../../../src/core/tools/ITool';
import type { PiiEntity } from '../../../../src/extensions/packs/pii-redaction/types';

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

/** Sample email entity matching "john@example.com" at position 12-28. */
const EMAIL_ENTITY: PiiEntity = {
  entityType: 'EMAIL',
  text: 'john@example.com',
  start: 12,
  end: 28,
  score: 1.0,
  source: 'regex',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PiiRedactTool', () => {
  let services: SharedServiceRegistry;
  let tool: PiiRedactTool;

  beforeEach(() => {
    services = new SharedServiceRegistry();
    vi.clearAllMocks();
    tool = new PiiRedactTool(services, {});
  });

  describe('metadata', () => {
    it('should have correct id, name, and category', () => {
      expect(tool.id).toBe('pii_redact');
      expect(tool.name).toBe('pii_redact');
      expect(tool.displayName).toBe('PII Redactor');
      expect(tool.category).toBe('security');
      expect(tool.hasSideEffects).toBe(false);
    });

    it('should have an input schema requiring "text"', () => {
      expect(tool.inputSchema.required).toContain('text');
      expect(tool.inputSchema.properties.text.type).toBe('string');
    });
  });

  describe('execute', () => {
    it('should redact PII and return sanitised text', async () => {
      const mockPipeline = (PiiDetectionPipeline as any).mock.results[
        (PiiDetectionPipeline as any).mock.results.length - 1
      ].value;

      mockPipeline.detect.mockResolvedValueOnce({
        entities: [EMAIL_ENTITY],
        inputLength: 28,
        processingTimeMs: 3,
        tiersExecuted: ['regex'],
        summary: '1 entity found: 1xEMAIL',
      });

      const result = await tool.execute(
        { text: 'Contact me: john@example.com' },
        CONTEXT,
      );

      expect(result.success).toBe(true);
      expect(result.output?.wasRedacted).toBe(true);
      expect(result.output?.redactedText).toContain('[EMAIL]');
      expect(result.output?.redactedText).not.toContain('john@example.com');
      expect(result.output?.originalText).toBe('Contact me: john@example.com');
      expect(result.output?.detectionResult.entities).toHaveLength(1);
    });

    it('should return wasRedacted = false for clean text', async () => {
      const result = await tool.execute(
        { text: 'Nothing sensitive here' },
        CONTEXT,
      );

      expect(result.success).toBe(true);
      expect(result.output?.wasRedacted).toBe(false);
      expect(result.output?.redactedText).toBe('Nothing sensitive here');
    });

    it('should use per-call redactionStyle override when provided', async () => {
      const mockPipeline = (PiiDetectionPipeline as any).mock.results[
        (PiiDetectionPipeline as any).mock.results.length - 1
      ].value;

      mockPipeline.detect.mockResolvedValueOnce({
        entities: [EMAIL_ENTITY],
        inputLength: 28,
        processingTimeMs: 2,
        tiersExecuted: ['regex'],
        summary: '1 entity found: 1xEMAIL',
      });

      const result = await tool.execute(
        { text: 'Contact me: john@example.com', redactionStyle: 'category-tag' },
        CONTEXT,
      );

      expect(result.success).toBe(true);
      // category-tag style produces <PII type="EMAIL">REDACTED</PII>.
      expect(result.output?.redactedText).toContain('<PII type="EMAIL">');
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

      mockPipeline.detect.mockRejectedValueOnce(
        new Error('Transformer model OOM'),
      );

      const result = await tool.execute(
        { text: 'Some text to redact' },
        CONTEXT,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Transformer model OOM');
    });
  });
});
