import { describe, it, expect } from 'vitest';
import {
  IProvider,
  ChatMessage,
  ModelCompletionOptions,
  ModelCompletionResponse,
  ProviderEmbeddingOptions,
  ProviderEmbeddingResponse,
  ModelInfo,
} from '../IProvider';

class MockAbortProvider implements IProvider {
  public readonly providerId = 'mock-abort';
  public isInitialized = false;
  public defaultModelId = 'mock';

  async initialize(_config: Record<string, unknown> = {}): Promise<void> {
    this.isInitialized = true;
  }

  async generateCompletion(
    _modelId: string,
    _messages: ChatMessage[],
    _options: ModelCompletionOptions
  ): Promise<ModelCompletionResponse> {
    throw new Error('not used');
  }

  async *generateCompletionStream(
    modelId: string,
    _messages: ChatMessage[],
    options: ModelCompletionOptions
  ): AsyncGenerator<ModelCompletionResponse> {
    const deltas = ['Hello ', 'there ', 'friend'];

    for (const [index, delta] of deltas.entries()) {
      if (options.abortSignal?.aborted) {
        yield this.createAbortChunk(modelId);
        return;
      }

      yield {
        id: `chunk-${index}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        modelId,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: null },
            finishReason: null,
          },
        ],
        responseTextDelta: delta,
      };

      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    yield {
      id: `final-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      modelId,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'complete' },
          finishReason: 'stop',
        },
      ],
      isFinal: true,
    };
  }

  async generateEmbeddings(
    _modelId: string,
    _texts: string[],
    _options?: ProviderEmbeddingOptions
  ): Promise<ProviderEmbeddingResponse> {
    return Promise.reject(new Error('not used'));
  }

  async listAvailableModels(): Promise<ModelInfo[]> {
    return [];
  }

  async getModelInfo(): Promise<ModelInfo | undefined> {
    return undefined;
  }

  async checkHealth(): Promise<{ isHealthy: boolean; details?: unknown }> {
    return { isHealthy: true };
  }

  async shutdown(): Promise<void> {
    this.isInitialized = false;
  }

  private createAbortChunk(modelId: string): ModelCompletionResponse {
    return {
      id: `abort-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      modelId,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: null },
          finishReason: 'stop',
        },
      ],
      error: {
        message: 'Stream aborted by caller',
        type: 'abort',
      },
      isFinal: true,
    };
  }
}

describe('AbortSignal streaming support', () => {
  it('emits abort final chunk with error.type="abort"', async () => {
    const provider = new MockAbortProvider();
    await provider.initialize();

    const controller = new AbortController();
    const stream = provider.generateCompletionStream('mock-model', [], {
      abortSignal: controller.signal,
    });

    const chunks: ModelCompletionResponse[] = [];
    let chunkIndex = 0;

    for await (const chunk of stream) {
      chunks.push(chunk);
      chunkIndex += 1;

      if (chunkIndex === 1) {
        controller.abort();
      }

      if (chunk.error?.type === 'abort') {
        break;
      }
    }

    const abortChunk = chunks.find((chunk) => chunk.error?.type === 'abort');
    expect(abortChunk).toBeTruthy();
    expect(abortChunk?.isFinal).toBe(true);
  });
});
