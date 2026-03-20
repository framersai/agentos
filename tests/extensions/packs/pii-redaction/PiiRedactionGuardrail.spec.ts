/**
 * @file PiiRedactionGuardrail.spec.ts
 * @description Unit tests for {@link PiiRedactionGuardrail}.
 *
 * Tests verify:
 * - SANITIZE action is returned with redacted text when PII is found in input
 * - null is returned for clean input (no PII)
 * - guardrailScope: 'input' disables evaluateOutput
 * - guardrailScope: 'output' disables evaluateInput
 * - GuardrailConfig is correctly derived from pack options
 *
 * The PiiDetectionPipeline is mocked to isolate guardrail logic from the
 * actual regex/NER/LLM detection tiers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PiiRedactionGuardrail } from '../../../../src/extensions/packs/pii-redaction/PiiRedactionGuardrail';
import { SharedServiceRegistry } from '../../../../src/extensions/SharedServiceRegistry';
import { GuardrailAction } from '../../../../src/core/guardrails/IGuardrailService';
import { AgentOSResponseChunkType } from '../../../../src/api/types/AgentOSResponse';
import type { GuardrailInputPayload, GuardrailOutputPayload } from '../../../../src/core/guardrails/IGuardrailService';
import type { PiiRedactionPackOptions, PiiEntity } from '../../../../src/extensions/packs/pii-redaction/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/**
 * Mock the PiiDetectionPipeline so we can control what it returns without
 * loading real NLP/regex recognisers.
 */
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

// Import the mocked class so we can access the mock instances.
import { PiiDetectionPipeline } from '../../../../src/extensions/packs/pii-redaction/PiiDetectionPipeline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal GuardrailInputPayload with the given text.
 */
function makeInputPayload(text: string): GuardrailInputPayload {
  return {
    context: { userId: 'u1', sessionId: 's1' },
    input: {
      userId: 'u1',
      sessionId: 's1',
      textInput: text,
    },
  };
}

/**
 * Create a minimal GuardrailOutputPayload for a TEXT_DELTA chunk.
 */
function makeOutputTextDelta(
  textDelta: string,
  streamId = 'stream-1',
  isFinal = false,
): GuardrailOutputPayload {
  return {
    context: { userId: 'u1', sessionId: 's1' },
    chunk: {
      type: AgentOSResponseChunkType.TEXT_DELTA,
      streamId,
      gmiInstanceId: 'gmi-1',
      personaId: 'p1',
      isFinal,
      timestamp: new Date().toISOString(),
      textDelta,
    } as any,
  };
}

/**
 * Create a minimal GuardrailOutputPayload for a FINAL_RESPONSE chunk.
 */
function makeFinalResponsePayload(
  finalResponseText: string,
  streamId = 'stream-1',
): GuardrailOutputPayload {
  return {
    context: { userId: 'u1', sessionId: 's1' },
    chunk: {
      type: AgentOSResponseChunkType.FINAL_RESPONSE,
      streamId,
      gmiInstanceId: 'gmi-1',
      personaId: 'p1',
      isFinal: true,
      timestamp: new Date().toISOString(),
      finalResponseText,
    } as any,
  };
}

/** Sample PII entities for mock detection results. */
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

describe('PiiRedactionGuardrail', () => {
  let services: SharedServiceRegistry;

  beforeEach(() => {
    services = new SharedServiceRegistry();
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // evaluateInput tests
  // -----------------------------------------------------------------------

  describe('evaluateInput', () => {
    it('should return SANITIZE with redacted text when PII is found', async () => {
      const guardrail = new PiiRedactionGuardrail(services, {});

      // Configure the mock pipeline to return a PII entity.
      const mockPipeline = (PiiDetectionPipeline as any).mock.results[
        (PiiDetectionPipeline as any).mock.results.length - 1
      ].value;

      mockPipeline.detect.mockResolvedValueOnce({
        entities: [EMAIL_ENTITY],
        inputLength: 28,
        processingTimeMs: 5,
        tiersExecuted: ['regex'],
        summary: '1 entity found: 1xEMAIL',
      });

      const payload = makeInputPayload('Contact me: john@example.com');
      const result = await guardrail.evaluateInput!(payload);

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.SANITIZE);
      expect(result!.modifiedText).toBeDefined();
      // The redacted text should contain the placeholder [EMAIL] instead
      // of the actual email address.
      expect(result!.modifiedText).toContain('[EMAIL]');
      expect(result!.modifiedText).not.toContain('john@example.com');
      expect(result!.reasonCode).toBe('PII_REDACTED');
    });

    it('should return null for clean input (no PII)', async () => {
      const guardrail = new PiiRedactionGuardrail(services, {});

      // Mock pipeline returns no entities (default mock behaviour).
      const payload = makeInputPayload('Hello world, nothing sensitive here');
      const result = await guardrail.evaluateInput!(payload);

      expect(result).toBeNull();
    });

    it('should return null when textInput is null', async () => {
      const guardrail = new PiiRedactionGuardrail(services, {});
      const payload: GuardrailInputPayload = {
        context: { userId: 'u1', sessionId: 's1' },
        input: {
          userId: 'u1',
          sessionId: 's1',
          textInput: null,
        },
      };

      const result = await guardrail.evaluateInput!(payload);
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // guardrailScope tests
  // -----------------------------------------------------------------------

  describe('guardrailScope', () => {
    it('should disable evaluateOutput when scope is "input"', async () => {
      const guardrail = new PiiRedactionGuardrail(services, {
        guardrailScope: 'input',
      });

      // Configure the mock to return PII.
      const mockPipeline = (PiiDetectionPipeline as any).mock.results[
        (PiiDetectionPipeline as any).mock.results.length - 1
      ].value;

      mockPipeline.detect.mockResolvedValue({
        entities: [EMAIL_ENTITY],
        inputLength: 28,
        processingTimeMs: 2,
        tiersExecuted: ['regex'],
        summary: '1 entity found: 1xEMAIL',
      });

      // evaluateOutput should return null regardless of PII in the chunk.
      const outputPayload = makeFinalResponsePayload(
        'Contact me: john@example.com',
      );
      const outputResult = await guardrail.evaluateOutput!(outputPayload);
      expect(outputResult).toBeNull();

      // evaluateInput should still work.
      const inputPayload = makeInputPayload('Contact me: john@example.com');
      const inputResult = await guardrail.evaluateInput!(inputPayload);
      expect(inputResult).not.toBeNull();
      expect(inputResult!.action).toBe(GuardrailAction.SANITIZE);
    });

    it('should disable evaluateInput when scope is "output"', async () => {
      const guardrail = new PiiRedactionGuardrail(services, {
        guardrailScope: 'output',
      });

      // evaluateInput should return null regardless of PII in the input.
      const inputPayload = makeInputPayload('My SSN is 123-45-6789');
      const inputResult = await guardrail.evaluateInput!(inputPayload);
      expect(inputResult).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // GuardrailConfig tests
  // -----------------------------------------------------------------------

  describe('config', () => {
    it('should set correct GuardrailConfig from options', () => {
      const guardrail = new PiiRedactionGuardrail(services, {
        evaluateStreamingChunks: true,
        maxStreamingEvaluations: 25,
      });

      expect(guardrail.config.evaluateStreamingChunks).toBe(true);
      expect(guardrail.config.maxStreamingEvaluations).toBe(25);
    });

    it('should apply default config values when options are omitted', () => {
      const guardrail = new PiiRedactionGuardrail(services, {});

      expect(guardrail.config.evaluateStreamingChunks).toBe(false);
      expect(guardrail.config.maxStreamingEvaluations).toBe(50);
    });
  });

  // -----------------------------------------------------------------------
  // evaluateOutput — streaming buffer tests
  // -----------------------------------------------------------------------

  describe('evaluateOutput', () => {
    it('should return null for TEXT_DELTA without sentence boundary', async () => {
      const guardrail = new PiiRedactionGuardrail(services, {});

      // Chunk without a sentence boundary — should buffer and return null.
      const payload = makeOutputTextDelta('Hello John');
      const result = await guardrail.evaluateOutput!(payload);
      expect(result).toBeNull();
    });

    it('should evaluate buffer at sentence boundary and return SANITIZE when PII found', async () => {
      const guardrail = new PiiRedactionGuardrail(services, {});

      // Get the mock pipeline for this guardrail instance.
      const mockPipeline = (PiiDetectionPipeline as any).mock.results[
        (PiiDetectionPipeline as any).mock.results.length - 1
      ].value;

      // First call: no boundary, returns null.
      mockPipeline.detect.mockResolvedValue({
        entities: [],
        inputLength: 0,
        processingTimeMs: 1,
        tiersExecuted: ['regex'],
        summary: 'No PII detected',
      });

      await guardrail.evaluateOutput!(
        makeOutputTextDelta('Contact me: john@example.com'),
      );

      // Second call: sentence boundary triggers evaluation.
      mockPipeline.detect.mockResolvedValueOnce({
        entities: [
          {
            entityType: 'EMAIL',
            text: 'john@example.com',
            start: 12,
            end: 28,
            score: 1.0,
            source: 'regex',
          },
        ],
        inputLength: 30,
        processingTimeMs: 3,
        tiersExecuted: ['regex'],
        summary: '1 entity found: 1xEMAIL',
      });

      const result = await guardrail.evaluateOutput!(
        makeOutputTextDelta('. More text'),
      );

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.SANITIZE);
      expect(result!.modifiedText).toContain('[EMAIL]');
    });

    it('should clean up buffer on FINAL_RESPONSE chunk', async () => {
      const guardrail = new PiiRedactionGuardrail(services, {});

      const mockPipeline = (PiiDetectionPipeline as any).mock.results[
        (PiiDetectionPipeline as any).mock.results.length - 1
      ].value;

      mockPipeline.detect.mockResolvedValueOnce({
        entities: [],
        inputLength: 5,
        processingTimeMs: 1,
        tiersExecuted: ['regex'],
        summary: 'No PII detected',
      });

      // FINAL_RESPONSE should trigger evaluation even without sentence boundary.
      const payload = makeFinalResponsePayload('Hello');
      const result = await guardrail.evaluateOutput!(payload);

      // No PII, so null is expected.
      expect(result).toBeNull();

      // Verify detect was called (buffer was flushed).
      expect(mockPipeline.detect).toHaveBeenCalledWith('Hello');
    });
  });
});
