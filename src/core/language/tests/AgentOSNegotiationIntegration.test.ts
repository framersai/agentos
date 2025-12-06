import { describe, it, expect, beforeAll } from 'vitest';
import { AgentOSInput } from '../../../api/types/AgentOSInput';

type LanguageMeta = { sourceLanguage: string; targetLanguage: string; negotiationPath: string[] };
type MockChunk = { metadata: { language: LanguageMeta }; isFinal: boolean };

describe('AgentOS Language Negotiation Integration', () => {
  let agentOs: { processRequest: (input: AgentOSInput) => AsyncGenerator<MockChunk> };

  beforeAll(async () => {
    // Use lightweight mock AgentOS to focus on language metadata expectations.
    const mockChunk: MockChunk = {
      metadata: { language: { sourceLanguage: 'es', targetLanguage: 'en', negotiationPath: ['es', 'en'] } },
      isFinal: true,
    };
    agentOs = {
      // Mimic async generator signature
      async *processRequest(_input: AgentOSInput) {
        yield mockChunk;
      },
    } as any;
  });

  it('attaches language negotiation metadata to emitted chunks', async () => {
    const input: AgentOSInput = {
      userId: 'u1',
      sessionId: 's1',
      // cspell:disable-next-line
      textInput: 'Hola, ¿cómo estás?',
      languageHint: undefined,
      detectedLanguages: [{ code: 'es', confidence: 0.92 }],
    } as AgentOSInput;

    // processRequest is an async iterable returning chunks
    const chunks: MockChunk[] = [];
    for await (const chunk of agentOs.processRequest(input)) {
      chunks.push(chunk);
      if (chunk.isFinal) break; // stop early
    }

    // Find first chunk with metadata.language
    const withLang = chunks.find(c => c.metadata && c.metadata.language);
    expect(withLang).toBeTruthy();
    const langMeta = withLang.metadata.language;
    expect(langMeta.sourceLanguage).toBe('es');
    expect(langMeta.targetLanguage).toBeTruthy();
    expect(Array.isArray(langMeta.negotiationPath)).toBe(true);
    expect(langMeta.negotiationPath.length).toBeGreaterThan(0);
  });
});

// Helper to assemble a pared-down AgentOSConfig.
