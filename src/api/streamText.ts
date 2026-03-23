// packages/agentos/src/api/streamText.ts
import { parseModelString, resolveProvider, createProviderManager } from './model.js';
import { adaptTools, type ToolDefinitionMap } from './tool-adapter.js';
import type { GenerateTextOptions, Message, TokenUsage, ToolCallRecord } from './generateText.js';

export type StreamPart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolName: string; args: unknown }
  | { type: 'tool-result'; toolName: string; result: unknown }
  | { type: 'error'; error: Error };

export interface StreamTextResult {
  textStream: AsyncIterable<string>;
  fullStream: AsyncIterable<StreamPart>;
  text: Promise<string>;
  usage: Promise<TokenUsage>;
  toolCalls: Promise<ToolCallRecord[]>;
}

/**
 * Stateless streaming text generation. Returns immediately with async iterables.
 */
export function streamText(opts: GenerateTextOptions): StreamTextResult {
  let resolveText: (v: string) => void;
  let resolveUsage: (v: TokenUsage) => void;
  let resolveToolCalls: (v: ToolCallRecord[]) => void;

  const textPromise = new Promise<string>(r => { resolveText = r; });
  const usagePromise = new Promise<TokenUsage>(r => { resolveUsage = r; });
  const toolCallsPromise = new Promise<ToolCallRecord[]>(r => { resolveToolCalls = r; });

  const parts: StreamPart[] = [];
  let fullText = '';
  const allToolCalls: ToolCallRecord[] = [];

  async function* runStream(): AsyncGenerator<StreamPart> {
    const { providerId, modelId } = parseModelString(opts.model);
    const resolved = resolveProvider(providerId, modelId, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
    const manager = await createProviderManager(resolved);
    const provider = manager.getProvider(resolved.providerId);
    if (!provider) throw new Error(`Provider ${resolved.providerId} not available.`);

    const messages: Array<Record<string, unknown>> = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    if (opts.messages) for (const m of opts.messages) messages.push({ role: m.role, content: m.content });
    if (opts.prompt) messages.push({ role: 'user', content: opts.prompt });

    const tools = adaptTools(opts.tools);
    const toolSchemas = tools.length > 0
      ? tools.map(t => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        }))
      : undefined;

    const stream = await provider.streamChatCompletion({
      model: resolved.modelId,
      messages: messages as any,
      tools: toolSchemas,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
    });

    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        fullText += delta.content;
        const part: StreamPart = { type: 'text', text: delta.content };
        parts.push(part);
        yield part;
      }
      if (chunk.usage) {
        usage.promptTokens += chunk.usage.prompt_tokens ?? 0;
        usage.completionTokens += chunk.usage.completion_tokens ?? 0;
        usage.totalTokens += chunk.usage.total_tokens ?? 0;
      }
    }

    resolveText!(fullText);
    resolveUsage!(usage);
    resolveToolCalls!(allToolCalls);
  }

  const fullStreamIterable = runStream();

  const textStreamIterable: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      const inner = fullStreamIterable[Symbol.asyncIterator]();
      return {
        async next() {
          while (true) {
            const { value, done } = await inner.next();
            if (done) return { value: undefined, done: true };
            if (value.type === 'text') return { value: value.text, done: false };
          }
        },
      };
    },
  };

  return {
    textStream: textStreamIterable,
    fullStream: fullStreamIterable,
    text: textPromise,
    usage: usagePromise,
    toolCalls: toolCallsPromise,
  };
}
