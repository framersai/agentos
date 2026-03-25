/**
 * @fileoverview Tests for ComposableToolBuilder.
 *
 * Covers:
 * 1. Single-step pipeline with `$input.*` template resolution
 * 2. Multi-step chaining via `$prev.output`
 * 3. Cross-step reference via `$steps[N].output`
 * 4. validate() rejects empty steps array
 * 5. validate() rejects a step with an empty tool name
 * 6. Pipeline aborts and surfaces error when a step returns `success: false`
 * 7. Nested object template resolution (values inside a plain-object inputMapping)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComposableToolBuilder } from '../ComposableToolBuilder.js';
import type { ComposableToolSpec } from '../types.js';
import type { ToolExecutionResult, ToolExecutionContext } from '../../core/tools/ITool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid ToolExecutionContext sufficient for unit testing. */
function makeContext(): ToolExecutionContext {
  return {
    gmiId: 'gmi-test',
    personaId: 'persona-test',
    userContext: { userId: 'user-1' } as any,
  };
}

/** Build a successful ToolExecutionResult. */
function ok(output: unknown): ToolExecutionResult {
  return { success: true, output };
}

/** Build a failed ToolExecutionResult. */
function fail(error: string): ToolExecutionResult {
  return { success: false, error };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ComposableToolBuilder', () => {
  let executeTool: ReturnType<typeof vi.fn>;
  let builder: ComposableToolBuilder;
  const ctx = makeContext();

  beforeEach(() => {
    executeTool = vi.fn();
    builder = new ComposableToolBuilder(executeTool as any);
  });

  // -------------------------------------------------------------------------
  // 1. Single step — $input.* resolution
  // -------------------------------------------------------------------------
  it('builds a single-step tool and resolves $input.* template', async () => {
    const spec: ComposableToolSpec = {
      mode: 'compose',
      steps: [
        {
          name: 'search',
          tool: 'web_search',
          inputMapping: { query: '$input.topic', maxResults: 5 },
        },
      ],
    };

    executeTool.mockResolvedValueOnce(ok({ results: ['result-a', 'result-b'] }));

    const tool = builder.build('research', 'Search a topic', {}, spec);
    const result = await tool.execute({ topic: 'quantum computing' }, ctx);

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ results: ['result-a', 'result-b'] });

    // Executor must have been called with the resolved argument.
    expect(executeTool).toHaveBeenCalledOnce();
    expect(executeTool).toHaveBeenCalledWith(
      'web_search',
      { query: 'quantum computing', maxResults: 5 },
      ctx,
    );
  });

  // -------------------------------------------------------------------------
  // 2. Multi-step chaining via $prev.output
  // -------------------------------------------------------------------------
  it('chains step outputs via $prev', async () => {
    const spec: ComposableToolSpec = {
      mode: 'compose',
      steps: [
        {
          name: 'fetch',
          tool: 'web_fetch',
          inputMapping: { url: '$input.url' },
        },
        {
          name: 'summarise',
          tool: 'summarise_text',
          inputMapping: { text: '$prev.body' },
        },
      ],
    };

    executeTool
      .mockResolvedValueOnce(ok({ body: 'Long article body…' }))
      .mockResolvedValueOnce(ok({ summary: 'Short summary.' }));

    const tool = builder.build('fetch_and_summarise', 'Fetch then summarise', {}, spec);
    const result = await tool.execute({ url: 'https://example.com' }, ctx);

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ summary: 'Short summary.' });

    // Second call must have received the first step's output via $prev.body.
    expect(executeTool).toHaveBeenCalledTimes(2);
    const [, secondArgs] = executeTool.mock.calls[1];
    expect(secondArgs).toEqual({ text: 'Long article body…' });
  });

  // -------------------------------------------------------------------------
  // 3. Cross-step reference via $steps[N].output
  // -------------------------------------------------------------------------
  it('references a specific step by index via $steps[N]', async () => {
    const spec: ComposableToolSpec = {
      mode: 'compose',
      steps: [
        {
          name: 'step0',
          tool: 'tool_a',
          inputMapping: { x: '$input.value' },
        },
        {
          name: 'step1',
          tool: 'tool_b',
          inputMapping: { y: '$input.value' },
        },
        {
          name: 'step2',
          tool: 'tool_c',
          // Explicitly reference the first step (index 0) rather than $prev
          inputMapping: { fromFirst: '$steps[0].data', fromSecond: '$steps[1].data' },
        },
      ],
    };

    executeTool
      .mockResolvedValueOnce(ok({ data: 'alpha' }))
      .mockResolvedValueOnce(ok({ data: 'beta' }))
      .mockResolvedValueOnce(ok({ combined: 'alpha+beta' }));

    const tool = builder.build('multi_ref', 'Three-step cross-reference', {}, spec);
    const result = await tool.execute({ value: 42 }, ctx);

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ combined: 'alpha+beta' });

    const [, thirdArgs] = executeTool.mock.calls[2];
    expect(thirdArgs).toEqual({ fromFirst: 'alpha', fromSecond: 'beta' });
  });

  // -------------------------------------------------------------------------
  // 4. validate() rejects empty steps array
  // -------------------------------------------------------------------------
  it('validate() returns invalid for an empty steps array', () => {
    const spec: ComposableToolSpec = { mode: 'compose', steps: [] };
    const result = builder.validate(spec);

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 5. validate() rejects step with empty tool name
  // -------------------------------------------------------------------------
  it('validate() returns invalid when a step has an empty tool name', () => {
    const spec: ComposableToolSpec = {
      mode: 'compose',
      steps: [
        { name: 'ok_step', tool: 'web_search', inputMapping: {} },
        { name: 'bad_step', tool: '   ', inputMapping: {} }, // whitespace-only
      ],
    };
    const result = builder.validate(spec);

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.includes('index 1'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 6. Pipeline aborts when a step fails
  // -------------------------------------------------------------------------
  it('returns an error result and stops the pipeline when a step fails', async () => {
    const spec: ComposableToolSpec = {
      mode: 'compose',
      steps: [
        { name: 'first', tool: 'tool_ok', inputMapping: {} },
        { name: 'second', tool: 'tool_fail', inputMapping: {} },
        { name: 'third', tool: 'tool_never', inputMapping: {} },
      ],
    };

    executeTool
      .mockResolvedValueOnce(ok({ value: 1 }))
      .mockResolvedValueOnce(fail('service unavailable'))
      // third step should never be called
      .mockResolvedValueOnce(ok({ value: 3 }));

    const tool = builder.build('fragile_pipeline', 'Pipeline that fails mid-way', {}, spec);
    const result = await tool.execute({}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('second');
    expect(result.error).toContain('service unavailable');

    // The third step executor should never have been invoked.
    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // 7. Nested object template resolution
  // -------------------------------------------------------------------------
  it('resolves $input.* references nested inside plain objects', async () => {
    const spec: ComposableToolSpec = {
      mode: 'compose',
      steps: [
        {
          name: 'nested_step',
          tool: 'complex_tool',
          inputMapping: {
            // Nested plain object containing a reference expression
            options: {
              query: '$input.topic',
              limit: 10,
            },
            // Top-level literal passthrough
            version: 2,
          },
        },
      ],
    };

    executeTool.mockResolvedValueOnce(ok({ ok: true }));

    const tool = builder.build('nested_test', 'Test nested resolution', {}, spec);
    await tool.execute({ topic: 'machine learning' }, ctx);

    const [, resolvedArgs] = executeTool.mock.calls[0];
    expect(resolvedArgs).toEqual({
      options: { query: 'machine learning', limit: 10 },
      version: 2,
    });
  });

  // -------------------------------------------------------------------------
  // Bonus: validate() returns valid for a well-formed spec
  // -------------------------------------------------------------------------
  it('validate() returns valid for a well-formed spec', () => {
    const spec: ComposableToolSpec = {
      mode: 'compose',
      steps: [{ name: 'step1', tool: 'web_search', inputMapping: { q: '$input.query' } }],
    };
    const result = builder.validate(spec);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });
});
