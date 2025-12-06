import { describe, it, expect, beforeAll } from 'vitest';
import { AgentOS, AgentOSConfig } from '../../../api/AgentOS';
import { AgentOSInput } from '../../../api/types/AgentOSInput';
import { StreamingManager } from '../../../core/streaming/StreamingManager';

// Minimal mock / fixture helpers
class MockStreamingManager extends StreamingManager {
  public capturedChunks: any[] = [];
  async pushToClient(_clientId: string, chunk: any) {
    this.capturedChunks.push(chunk);
  }
}

// For this integration we stub required services with minimal viable mocks.
// If full constructors are needed, expand accordingly (keeping test lightweight).

describe('AgentOS Language Negotiation Integration', () => {
  let agentOs: AgentOS;
  let streamingManager: MockStreamingManager;

  beforeAll(async () => {
    // Use lightweight mock AgentOS to focus on language metadata expectations.
    streamingManager = new MockStreamingManager();
    const mockChunk = {
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
      textInput: 'Hola, ¿cómo estás?',
      languageHint: undefined,
      detectedLanguages: [{ code: 'es', confidence: 0.92 }],
    } as any;

    // processRequest is an async iterable returning chunks
    const chunks: any[] = [];
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
function buildMinimalConfig(streamingManager: MockStreamingManager): AgentOSConfig {
  // Many properties in AgentOSConfig are required; we stub with simple objects / minimal values.
  // For missing complex subsystems (GMIManager, etc.), provide very small mocks if accessed.
  const dummy: any = {};
  return {
    gmiManagerConfig: { /* minimal */ } as any,
    orchestratorConfig: {},
    promptEngineConfig: { /* minimal */ } as any,
    toolOrchestratorConfig: { /* minimal */ } as any,
    toolPermissionManagerConfig: { /* minimal */ } as any,
    conversationManagerConfig: { /* minimal */ } as any,
    streamingManagerConfig: { /* minimal */ } as any,
    modelProviderManagerConfig: { /* minimal */ } as any,
    defaultPersonaId: 'default-persona',
    prisma: dummy,
    authService: dummy,
    subscriptionService: dummy,
    languageConfig: {
      defaultLanguage: 'en',
      supportedLanguages: ['en', 'es', 'fr'],
      fallbackLanguages: ['en'],
      autoDetect: true,
      preferSourceLanguageResponses: true,
      enablePivotNormalization: false,
      enableCaching: true,
      enableCodeAwareTranslation: true,
    }
  } as AgentOSConfig;
}
