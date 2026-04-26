/**
 * @file TypedNetworkObserver.test.ts
 * @description Contract tests for the 6-step LLM extractor. Uses a
 * mocked LLM to assert: structured-output parsing, ID generation
 * format, all-bank routing through the observer, validation rejection
 * of malformed output, and code-fence tolerance.
 */

import { describe, it, expect } from 'vitest';
import { TypedNetworkObserver, type ITypedExtractionLLM } from '../TypedNetworkObserver.js';

function mockLLM(response: string): ITypedExtractionLLM {
  return { invoke: async () => response };
}

describe('TypedNetworkObserver', () => {
  it('parses valid LLM output into TypedFact[]', async () => {
    const llm = mockLLM(JSON.stringify({
      facts: [{
        text: 'Berlin is in Germany',
        bank: 'WORLD',
        temporal: { mention: '2026-04-26T10:00:00Z' },
        participants: [],
        reasoning_markers: [],
        entities: ['Berlin', 'Germany'],
        confidence: 1.0,
      }],
    }));
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('User: Where is Berlin? Assistant: In Germany.', 'session-1');
    expect(facts).toHaveLength(1);
    expect(facts[0].bank).toBe('WORLD');
    expect(facts[0].entities).toContain('Berlin');
    expect(facts[0].id).toBe('session-1-fact-0');
  });

  it('generates sequential IDs for multiple facts', async () => {
    const llm = mockLLM(JSON.stringify({
      facts: [
        { text: 'A', bank: 'WORLD', temporal: { mention: '2026-04-26T10:00:00Z' }, participants: [], reasoning_markers: [], entities: [], confidence: 1.0 },
        { text: 'B', bank: 'EXPERIENCE', temporal: { mention: '2026-04-26T10:01:00Z' }, participants: [], reasoning_markers: [], entities: [], confidence: 1.0 },
        { text: 'C', bank: 'OPINION', temporal: { mention: '2026-04-26T10:02:00Z' }, participants: [], reasoning_markers: [], entities: [], confidence: 0.7 },
      ],
    }));
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('text', 'sx');
    expect(facts.map((f) => f.id)).toEqual(['sx-fact-0', 'sx-fact-1', 'sx-fact-2']);
  });

  it('routes facts into all four banks', async () => {
    const llm = mockLLM(JSON.stringify({
      facts: [
        { text: 'World', bank: 'WORLD', temporal: { mention: 'now' }, participants: [], reasoning_markers: [], entities: [], confidence: 1.0 },
        { text: 'Exp', bank: 'EXPERIENCE', temporal: { mention: 'now' }, participants: [], reasoning_markers: [], entities: [], confidence: 1.0 },
        { text: 'Op', bank: 'OPINION', temporal: { mention: 'now' }, participants: [], reasoning_markers: [], entities: [], confidence: 0.5 },
        { text: 'Obs', bank: 'OBSERVATION', temporal: { mention: 'now' }, participants: [], reasoning_markers: [], entities: [], confidence: 1.0 },
      ],
    }));
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('text', 's1');
    const banks = facts.map((f) => f.bank);
    expect(banks).toEqual(['WORLD', 'EXPERIENCE', 'OPINION', 'OBSERVATION']);
  });

  it('snake_case → camelCase translation for reasoning_markers', async () => {
    const llm = mockLLM(JSON.stringify({
      facts: [{
        text: 'Because the user prefers TypeScript, we use Bun',
        bank: 'EXPERIENCE',
        temporal: { mention: '2026-04-26T10:00:00Z' },
        participants: [],
        reasoning_markers: ['Because', 'we use'],
        entities: ['TypeScript', 'Bun'],
        confidence: 1.0,
      }],
    }));
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('text', 's1');
    expect(facts[0].reasoningMarkers).toEqual(['Because', 'we use']);
  });

  it('drops fact with empty text (per-fact tolerance)', async () => {
    const llm = mockLLM('{"facts": [{"text": ""}]}');
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('blah', 'session-2');
    expect(facts).toEqual([]);
  });

  it('drops fact with bank label that does not coerce to W/E/O/S', async () => {
    const llm = mockLLM(JSON.stringify({
      facts: [{
        text: 'foo',
        bank: 'FOO',
        temporal: { mention: 'now' },
        participants: [],
        reasoning_markers: [],
        entities: [],
        confidence: 1.0,
      }],
    }));
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('text', 's1');
    expect(facts).toEqual([]);
  });

  it('drops fact with confidence outside [0, 1]', async () => {
    const llm = mockLLM(JSON.stringify({
      facts: [{
        text: 'foo',
        bank: 'OPINION',
        temporal: { mention: 'now' },
        participants: [],
        reasoning_markers: [],
        entities: [],
        confidence: 1.5,
      }],
    }));
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('text', 's1');
    expect(facts).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Tolerance fixes (Phase 4c smoke surfaced 240+ zod errors at gpt-5-mini)
  // ---------------------------------------------------------------------------

  it('auto-wraps top-level array as {facts: ...} when LLM omits the wrapping object', async () => {
    // gpt-5-mini frequently returns a bare facts array instead of {facts: [...]}.
    // The observer detects this shape and wraps it so the rest of the pipeline
    // works unchanged.
    const llm = mockLLM(JSON.stringify([{
      text: 'Berlin is in Germany',
      bank: 'WORLD',
      temporal: { mention: '2026-04-26' },
      participants: [],
      reasoning_markers: [],
      entities: ['Berlin', 'Germany'],
      confidence: 1.0,
    }]));
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('User: Where is Berlin?', 'session-aw');
    expect(facts).toHaveLength(1);
    expect(facts[0].bank).toBe('WORLD');
    expect(facts[0].entities).toContain('Berlin');
  });

  it('drops invalid facts and keeps valid facts in the same response', async () => {
    // Per-fact tolerance: one bad apple does not spoil the bunch. The
    // shipped strict-mode parser threw on any single-fact failure, losing
    // every other fact in the same extraction call.
    const llm = mockLLM(JSON.stringify({
      facts: [
        {
          text: 'Berlin is in Germany',
          bank: 'WORLD',
          temporal: { mention: '2026-04-26' },
          participants: [],
          reasoning_markers: [],
          entities: ['Berlin'],
          confidence: 1.0,
        },
        null,
        'a string fact',
        {
          text: 'Munich is in Germany',
          bank: 'WORLD',
          temporal: { mention: '2026-04-26' },
          participants: [],
          reasoning_markers: [],
          entities: ['Munich'],
          confidence: 1.0,
        },
      ],
    }));
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('blah', 'session-pft');
    expect(facts).toHaveLength(2);
    expect(facts.map((f) => f.text)).toEqual([
      'Berlin is in Germany',
      'Munich is in Germany',
    ]);
  });

  it('defaults missing array fields (participants, reasoning_markers, entities) to []', async () => {
    // gpt-5-mini frequently omits empty array fields entirely instead of
    // emitting them as []. The schema accepts the missing fields and fills
    // in [].
    const llm = mockLLM(JSON.stringify({
      facts: [{
        text: 'Berlin is in Germany',
        bank: 'WORLD',
        temporal: { mention: '2026-04-26' },
        confidence: 1.0,
        // missing: participants, reasoning_markers, entities
      }],
    }));
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('blah', 'session-def');
    expect(facts).toHaveLength(1);
    expect(facts[0].participants).toEqual([]);
    expect(facts[0].reasoningMarkers).toEqual([]);
    expect(facts[0].entities).toEqual([]);
  });

  it('coerces lowercase bank to uppercase before validation', async () => {
    // The 6-step prompt instructs UPPERCASE banks but the LLM sometimes
    // emits lowercase. A single uppercase coercion at parse time recovers
    // the fact instead of dropping it.
    const llm = mockLLM(JSON.stringify({
      facts: [{
        text: 'Berlin is in Germany',
        bank: 'world',
        temporal: { mention: '2026-04-26' },
        participants: [],
        reasoning_markers: [],
        entities: ['Berlin'],
        confidence: 1.0,
      }],
    }));
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('blah', 'session-co');
    expect(facts).toHaveLength(1);
    expect(facts[0].bank).toBe('WORLD');
  });

  it('retries once when outer parse fails completely (spec section 6 retry path)', async () => {
    // Spec §6: "malformed outputs are retried once with the validation
    // error appended to the prompt." Originally specified, not implemented
    // in shipping code. Only retries on catastrophic outer failure
    // (invalid JSON, primitive value, missing facts key) — per-fact errors
    // are handled silently via tolerance above.
    let calls = 0;
    const llm: ITypedExtractionLLM = {
      invoke: async () => {
        calls += 1;
        if (calls === 1) return 'definitely not json';
        return JSON.stringify({
          facts: [{
            text: 'Berlin is in Germany',
            bank: 'WORLD',
            temporal: { mention: '2026-04-26' },
            participants: [],
            reasoning_markers: [],
            entities: ['Berlin'],
            confidence: 1.0,
          }],
        });
      },
    };
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('blah', 'session-rt');
    expect(calls).toBe(2);
    expect(facts).toHaveLength(1);
  });

  it('returns [] when retry also fails (no infinite retry loop)', async () => {
    let calls = 0;
    const llm: ITypedExtractionLLM = {
      invoke: async () => {
        calls += 1;
        return 'still not json';
      },
    };
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('blah', 'session-rt2');
    expect(calls).toBe(2);
    expect(facts).toEqual([]);
  });

  it('tolerates triple-backtick code fence around JSON', async () => {
    const llm = mockLLM('```json\n{"facts": []}\n```');
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('text', 's1');
    expect(facts).toEqual([]);
  });

  it('tolerates bare backticks without language tag', async () => {
    const llm = mockLLM('```\n{"facts": []}\n```');
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('text', 's1');
    expect(facts).toEqual([]);
  });

  it('tolerates non-json language tags on code fences (e.g. javascript)', async () => {
    // Some LLM providers (or mis-prompted models) wrap output in ```javascript
    // or ```typescript fences. We accept any alphabetic language tag, not
    // just `json`, so a single tag drift doesn't cause SyntaxError.
    const llm = mockLLM('```javascript\n{"facts": []}\n```');
    const obs = new TypedNetworkObserver({ llm });
    const facts = await obs.extract('text', 's1');
    expect(facts).toEqual([]);
  });

  it('passes maxTokens and temperature to the LLM', async () => {
    let capturedArgs: { maxTokens: number; temperature: number } | undefined;
    const llm: ITypedExtractionLLM = {
      invoke: async (args) => {
        capturedArgs = { maxTokens: args.maxTokens, temperature: args.temperature };
        return JSON.stringify({ facts: [] });
      },
    };
    const obs = new TypedNetworkObserver({ llm, maxTokens: 8192, temperature: 0.2 });
    await obs.extract('text', 's1');
    expect(capturedArgs?.maxTokens).toBe(8192);
    expect(capturedArgs?.temperature).toBe(0.2);
  });

  it('default maxTokens=4096, temperature=0', async () => {
    let capturedArgs: { maxTokens: number; temperature: number } | undefined;
    const llm: ITypedExtractionLLM = {
      invoke: async (args) => {
        capturedArgs = { maxTokens: args.maxTokens, temperature: args.temperature };
        return JSON.stringify({ facts: [] });
      },
    };
    const obs = new TypedNetworkObserver({ llm });
    await obs.extract('text', 's1');
    expect(capturedArgs?.maxTokens).toBe(4096);
    expect(capturedArgs?.temperature).toBe(0);
  });
});
