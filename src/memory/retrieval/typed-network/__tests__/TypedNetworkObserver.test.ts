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

  it('throws on missing required field (zod validation)', async () => {
    const llm = mockLLM('{"facts": [{"text": ""}]}');
    const obs = new TypedNetworkObserver({ llm });
    await expect(obs.extract('blah', 'session-2')).rejects.toThrow();
  });

  it('throws on unknown bank label', async () => {
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
    await expect(obs.extract('text', 's1')).rejects.toThrow();
  });

  it('throws on confidence outside [0, 1]', async () => {
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
    await expect(obs.extract('text', 's1')).rejects.toThrow();
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
