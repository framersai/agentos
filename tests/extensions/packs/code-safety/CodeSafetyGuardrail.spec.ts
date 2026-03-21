/**
 * @file CodeSafetyGuardrail.spec.ts
 * @description Unit tests for {@link CodeSafetyGuardrail}.
 *
 * ## Test strategy
 *
 * The guardrail is tested across both evaluation paths:
 *
 * **evaluateOutput:**
 * - TEXT_DELTA chunk with a complete code fence containing `eval` → BLOCK (CODE_SAFETY_CRITICAL)
 * - TEXT_DELTA chunk with clean code inside a fence → null
 * - TOOL_CALL_REQUEST for `shell_execute` with a dangerous command → BLOCK
 * - TOOL_CALL_REQUEST for an un-monitored tool → null
 * - isFinal=true flushes the buffer and scans any accumulated content
 * - Non-code TEXT_DELTA (plain prose, no fences) → null
 * - scope 'input' logic: calling evaluateOutput when the chunk has no code → null
 *
 * **evaluateInput:**
 * - Text with a Markdown code fence containing dangerous patterns → BLOCK
 * - Plain text with no code → null
 * - null textInput → null
 *
 * **Action mapping:**
 * - blocking violations → GuardrailAction.BLOCK with correct reasonCode
 * - flagging violations → GuardrailAction.FLAG with correct reasonCode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CodeSafetyGuardrail } from '../../../../src/extensions/packs/code-safety/CodeSafetyGuardrail';
import { CodeSafetyScanner } from '../../../../src/extensions/packs/code-safety/CodeSafetyScanner';
import { DEFAULT_RULES } from '../../../../src/extensions/packs/code-safety/DefaultRules';
import type { ICodeSafetyRule } from '../../../../src/extensions/packs/code-safety/types';
import { GuardrailAction } from '../../../../src/core/guardrails/IGuardrailService';
import type {
  GuardrailContext,
  GuardrailInputPayload,
  GuardrailOutputPayload,
} from '../../../../src/core/guardrails/IGuardrailService';
import { AgentOSResponseChunkType } from '../../../../src/api/types/AgentOSResponse';
import type { AgentOSInput } from '../../../../src/api/types/AgentOSInput';

// ---------------------------------------------------------------------------
// Test fixtures and helper factories
// ---------------------------------------------------------------------------

/**
 * Minimal guardrail context used across all tests.
 * Real implementations would vary these per user/session; for our tests the
 * specific values don't affect guardrail logic.
 */
const TEST_CONTEXT: GuardrailContext = {
  userId: 'test-user',
  sessionId: 'test-session',
  personaId: 'default',
};

/**
 * Build a minimal TEXT_DELTA response chunk for use in output evaluation tests.
 *
 * @param text     - The text delta content.
 * @param streamId - Stream identifier (default: 's1').
 * @param isFinal  - Whether this is the final chunk in the stream.
 */
function textDeltaChunk(
  text: string,
  streamId = 's1',
  isFinal = false,
): GuardrailOutputPayload {
  return {
    context: TEST_CONTEXT,
    chunk: {
      type: AgentOSResponseChunkType.TEXT_DELTA,
      streamId,
      gmiInstanceId: 'gmi-1',
      personaId: 'default',
      isFinal,
      timestamp: new Date().toISOString(),
      textDelta: text,
    } as any,
  };
}

/**
 * Build a minimal TOOL_CALL_REQUEST response chunk for output evaluation tests.
 *
 * @param toolName  - Name of the tool being called.
 * @param args      - Tool call arguments.
 * @param streamId  - Stream identifier (default: 's1').
 */
function toolCallRequestChunk(
  toolName: string,
  args: Record<string, any>,
  streamId = 's1',
): GuardrailOutputPayload {
  return {
    context: TEST_CONTEXT,
    chunk: {
      type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
      streamId,
      gmiInstanceId: 'gmi-1',
      personaId: 'default',
      isFinal: false,
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: 'call-1',
          name: toolName,
          arguments: args,
        },
      ],
    } as any,
  };
}

/**
 * Build a minimal input evaluation payload.
 *
 * @param textInput - The user's text input (may be null).
 */
function inputPayload(textInput: string | null): GuardrailInputPayload {
  return {
    context: TEST_CONTEXT,
    input: {
      userId: 'test-user',
      sessionId: 'test-session',
      textInput,
    } as AgentOSInput,
  };
}

// ---------------------------------------------------------------------------
// A low-severity custom rule for testing FLAG path (medium severity → flag)
// ---------------------------------------------------------------------------

/**
 * Custom rule that fires on the literal string `MEDIUM_MARKER` at medium severity.
 * Medium severity → action 'flag' by default → should produce GuardrailAction.FLAG.
 */
const MEDIUM_FLAG_RULE: ICodeSafetyRule = {
  id: 'test-medium-flag',
  name: 'Test medium flag rule',
  description: 'Fires on MEDIUM_MARKER at medium severity.',
  category: 'other',
  severity: 'medium',
  patterns: { '*': [/MEDIUM_MARKER/] },
};

/**
 * Custom rule that fires on `LOW_MARKER` at low severity.
 * Low severity → action 'flag' by default → should produce GuardrailAction.FLAG
 * with reasonCode CODE_SAFETY_LOW.
 */
const LOW_FLAG_RULE: ICodeSafetyRule = {
  id: 'test-low-flag',
  name: 'Test low flag rule',
  description: 'Fires on LOW_MARKER at low severity.',
  category: 'other',
  severity: 'low',
  patterns: { '*': [/LOW_MARKER/] },
};

// ---------------------------------------------------------------------------
// Main test suite
// ---------------------------------------------------------------------------

describe('CodeSafetyGuardrail', () => {
  // -----------------------------------------------------------------------
  // Construction and config
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('can be instantiated with default options', () => {
      const scanner = new CodeSafetyScanner();
      const guardrail = new CodeSafetyGuardrail({}, scanner);
      expect(guardrail).toBeDefined();
    });

    it('config.evaluateStreamingChunks is true', () => {
      const scanner = new CodeSafetyScanner();
      const guardrail = new CodeSafetyGuardrail({}, scanner);
      expect(guardrail.config.evaluateStreamingChunks).toBe(true);
    });

    it('config.canSanitize is false', () => {
      const scanner = new CodeSafetyScanner();
      const guardrail = new CodeSafetyGuardrail({}, scanner);
      expect(guardrail.config.canSanitize).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // evaluateOutput — TEXT_DELTA path
  // -----------------------------------------------------------------------

  describe('evaluateOutput — TEXT_DELTA', () => {
    let scanner: CodeSafetyScanner;
    let guardrail: CodeSafetyGuardrail;

    beforeEach(() => {
      // Use default rules which include the eval/injection rule.
      scanner = new CodeSafetyScanner();
      guardrail = new CodeSafetyGuardrail({}, scanner);
    });

    it('complete code fence with eval → BLOCK with CODE_SAFETY_CRITICAL', async () => {
      // Deliver a chunk that contains a complete code fence with eval(x).
      // A complete fence has both opening and closing ```.
      const chunk = textDeltaChunk(
        '```javascript\neval(user_input);\n```',
      );

      const result = await guardrail.evaluateOutput(chunk);

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.BLOCK);
      expect(result!.reasonCode).toBe('CODE_SAFETY_CRITICAL');
    });

    it('complete code fence with clean code → null', async () => {
      const chunk = textDeltaChunk(
        '```javascript\nconst x = 1 + 2;\n```',
      );

      const result = await guardrail.evaluateOutput(chunk);

      expect(result).toBeNull();
    });

    it('plain prose TEXT_DELTA (no code fence) → null', async () => {
      // Plain text without any ``` delimiters — nothing to scan.
      const chunk = textDeltaChunk(
        'Here is some explanation without any code.',
      );

      const result = await guardrail.evaluateOutput(chunk);

      expect(result).toBeNull();
    });

    it('split code fence across two chunks — second completes it → BLOCK', async () => {
      // Simulate the fence arriving in two TEXT_DELTA chunks.
      const chunk1 = textDeltaChunk('```python\neval(x)\n', 's2', false);
      const chunk2 = textDeltaChunk('```', 's2', false);

      // First chunk: opens fence but does not close it — should not trigger yet.
      const result1 = await guardrail.evaluateOutput(chunk1);
      // First chunk has only one ```, so no complete fence yet.
      expect(result1).toBeNull();

      // Second chunk: closes the fence — now there are two ``` → scan fires.
      const result2 = await guardrail.evaluateOutput(chunk2);
      expect(result2).not.toBeNull();
      expect(result2!.action).toBe(GuardrailAction.BLOCK);
    });

    it('isFinal=true flushes remaining buffer and scans it', async () => {
      // Deliver a chunk with isFinal=true that contains a dangerous fence.
      const chunk = textDeltaChunk(
        '```python\neval(user_code)\n```',
        's3',
        true, // isFinal
      );

      const result = await guardrail.evaluateOutput(chunk);

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.BLOCK);
    });

    it('medium-severity violation → FLAG with CODE_SAFETY_MEDIUM', async () => {
      // Use a custom scanner with a medium-severity rule.
      const customScanner = new CodeSafetyScanner([MEDIUM_FLAG_RULE]);
      const customGuardrail = new CodeSafetyGuardrail({}, customScanner);

      const chunk = textDeltaChunk(
        '```\nMEDIUM_MARKER is here\n```',
      );

      const result = await customGuardrail.evaluateOutput(chunk);

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.FLAG);
      expect(result!.reasonCode).toBe('CODE_SAFETY_MEDIUM');
    });

    it('low-severity violation → FLAG with CODE_SAFETY_LOW', async () => {
      const customScanner = new CodeSafetyScanner([LOW_FLAG_RULE]);
      const customGuardrail = new CodeSafetyGuardrail({}, customScanner);

      const chunk = textDeltaChunk(
        '```\nLOW_MARKER detected\n```',
      );

      const result = await customGuardrail.evaluateOutput(chunk);

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.FLAG);
      expect(result!.reasonCode).toBe('CODE_SAFETY_LOW');
    });

    it('different streamIds are buffered independently', async () => {
      // Two streams: s-a with dangerous code, s-b with clean code.
      const dangerousChunk = textDeltaChunk(
        '```python\neval(x)\n```',
        's-a',
      );
      const cleanChunk = textDeltaChunk(
        '```python\nx = 1 + 2\n```',
        's-b',
      );

      const [dangerousResult, cleanResult] = await Promise.all([
        guardrail.evaluateOutput(dangerousChunk),
        guardrail.evaluateOutput(cleanChunk),
      ]);

      expect(dangerousResult).not.toBeNull();
      expect(dangerousResult!.action).toBe(GuardrailAction.BLOCK);
      expect(cleanResult).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // evaluateOutput — TOOL_CALL_REQUEST path
  // -----------------------------------------------------------------------

  describe('evaluateOutput — TOOL_CALL_REQUEST', () => {
    let scanner: CodeSafetyScanner;
    let guardrail: CodeSafetyGuardrail;

    beforeEach(() => {
      scanner = new CodeSafetyScanner();
      guardrail = new CodeSafetyGuardrail({}, scanner);
    });

    it('shell_execute with path-traversal command → BLOCK', async () => {
      // The path-traversal-dotdot rule has a '*' pattern that matches ../ in any
      // language.  A shell command reading ../../etc/passwd is a classic attack.
      const chunk = toolCallRequestChunk('shell_execute', {
        command: 'cat ../../etc/passwd',
      });

      const result = await guardrail.evaluateOutput(chunk);

      // path-traversal-dotdot (severity: high, action: block) should fire.
      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.BLOCK);
    });

    it('shell_execute with safe command → null', async () => {
      const chunk = toolCallRequestChunk('shell_execute', {
        command: 'ls -la /tmp',
      });

      const result = await guardrail.evaluateOutput(chunk);

      expect(result).toBeNull();
    });

    it('run_sql with SQL injection → BLOCK', async () => {
      const chunk = toolCallRequestChunk('run_sql', {
        query: "SELECT * FROM users WHERE name = '' OR 1=1 --",
      });

      const result = await guardrail.evaluateOutput(chunk);

      // sql-injection-keywords should fire on OR 1=1
      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.BLOCK);
    });

    it('un-monitored tool → null (not scanned)', async () => {
      // 'search_web' is not in DEFAULT_CODE_EXECUTING_TOOLS.
      const chunk = toolCallRequestChunk('search_web', {
        query: 'eval python vulnerabilities',
      });

      const result = await guardrail.evaluateOutput(chunk);

      // The tool is not in the monitored list — should pass through.
      expect(result).toBeNull();
    });

    it('tool in monitored list but missing code argument → null', async () => {
      // shell_execute is monitored but we pass an empty command.
      const chunk = toolCallRequestChunk('shell_execute', {
        command: '',
      });

      const result = await guardrail.evaluateOutput(chunk);

      // Empty string → nothing to scan → null.
      expect(result).toBeNull();
    });

    it('custom codeExecutingTools option is respected', async () => {
      // Configure a custom guardrail that monitors 'my_custom_tool'.
      const customGuardrail = new CodeSafetyGuardrail(
        {
          codeExecutingTools: ['my_custom_tool'],
          codeArgumentMapping: {
            my_custom_tool: { argKey: 'script', language: 'python' },
          },
        },
        scanner,
      );

      const chunk = toolCallRequestChunk('my_custom_tool', {
        script: 'eval(user_code)',
      });

      const result = await customGuardrail.evaluateOutput(chunk);

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.BLOCK);
    });
  });

  // -----------------------------------------------------------------------
  // evaluateInput
  // -----------------------------------------------------------------------

  describe('evaluateInput', () => {
    let scanner: CodeSafetyScanner;
    let guardrail: CodeSafetyGuardrail;

    beforeEach(() => {
      scanner = new CodeSafetyScanner();
      guardrail = new CodeSafetyGuardrail({}, scanner);
    });

    it('user input with eval in a code fence → BLOCK', async () => {
      const payload = inputPayload(
        'Please run this for me:\n```python\neval(user_input)\n```',
      );

      const result = await guardrail.evaluateInput(payload);

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.BLOCK);
      expect(result!.reasonCode).toBe('CODE_SAFETY_CRITICAL');
    });

    it('user input with plain safe text → null', async () => {
      const payload = inputPayload(
        'Can you help me write a function to add two numbers?',
      );

      const result = await guardrail.evaluateInput(payload);

      expect(result).toBeNull();
    });

    it('user input with clean code fence → null', async () => {
      const payload = inputPayload(
        'Here is my code:\n```python\ndef add(a, b):\n    return a + b\n```',
      );

      const result = await guardrail.evaluateInput(payload);

      expect(result).toBeNull();
    });

    it('null textInput → null', async () => {
      const payload = inputPayload(null);

      const result = await guardrail.evaluateInput(payload);

      expect(result).toBeNull();
    });

    it('empty string textInput → null', async () => {
      const payload = inputPayload('');

      const result = await guardrail.evaluateInput(payload);

      expect(result).toBeNull();
    });

    it('user input with pickle.loads → BLOCK with CODE_SAFETY_CRITICAL', async () => {
      const payload = inputPayload(
        'Can you run:\n```python\nimport pickle\nobj = pickle.loads(data)\n```',
      );

      const result = await guardrail.evaluateInput(payload);

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.BLOCK);
    });
  });

  // -----------------------------------------------------------------------
  // Result metadata
  // -----------------------------------------------------------------------

  describe('result metadata', () => {
    it('BLOCK result includes violations in metadata', async () => {
      const scanner = new CodeSafetyScanner();
      const guardrail = new CodeSafetyGuardrail({}, scanner);

      const chunk = textDeltaChunk('```python\neval(x)\n```');
      const result = await guardrail.evaluateOutput(chunk);

      expect(result).not.toBeNull();
      expect(result!.metadata).toBeDefined();
      expect(Array.isArray((result!.metadata as any).violations)).toBe(true);
      expect((result!.metadata as any).violations.length).toBeGreaterThan(0);
    });

    it('BLOCK result includes a human-readable reason string', async () => {
      const scanner = new CodeSafetyScanner();
      const guardrail = new CodeSafetyGuardrail({}, scanner);

      const chunk = textDeltaChunk('```python\neval(x)\n```');
      const result = await guardrail.evaluateOutput(chunk);

      expect(result!.reason).toBeDefined();
      expect(typeof result!.reason).toBe('string');
      expect(result!.reason!.length).toBeGreaterThan(0);
    });

    it('FLAG result includes violations in metadata', async () => {
      const customScanner = new CodeSafetyScanner([MEDIUM_FLAG_RULE]);
      const customGuardrail = new CodeSafetyGuardrail({}, customScanner);

      const chunk = textDeltaChunk('```\nMEDIUM_MARKER here\n```');
      const result = await customGuardrail.evaluateOutput(chunk);

      expect(result).not.toBeNull();
      expect(result!.action).toBe(GuardrailAction.FLAG);
      expect(Array.isArray((result!.metadata as any).violations)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Non-code chunk types
  // -----------------------------------------------------------------------

  describe('non-TEXT_DELTA / non-TOOL_CALL_REQUEST chunks', () => {
    it('FINAL_RESPONSE chunk without buffered content → null', async () => {
      const scanner = new CodeSafetyScanner();
      const guardrail = new CodeSafetyGuardrail({}, scanner);

      const payload: GuardrailOutputPayload = {
        context: TEST_CONTEXT,
        chunk: {
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'sf',
          gmiInstanceId: 'gmi-1',
          personaId: 'default',
          isFinal: true,
          timestamp: new Date().toISOString(),
          finalResponseText: 'All done.',
        } as any,
      };

      const result = await guardrail.evaluateOutput(payload);

      // No buffered content for this stream — should be null.
      expect(result).toBeNull();
    });

    it('SYSTEM_PROGRESS chunk → null', async () => {
      const scanner = new CodeSafetyScanner();
      const guardrail = new CodeSafetyGuardrail({}, scanner);

      const payload: GuardrailOutputPayload = {
        context: TEST_CONTEXT,
        chunk: {
          type: AgentOSResponseChunkType.SYSTEM_PROGRESS,
          streamId: 'sp',
          gmiInstanceId: 'gmi-1',
          personaId: 'default',
          isFinal: false,
          timestamp: new Date().toISOString(),
          message: 'Thinking...',
        } as any,
      };

      const result = await guardrail.evaluateOutput(payload);

      expect(result).toBeNull();
    });
  });
});
