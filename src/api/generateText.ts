import { parseModelString, resolveProvider, createProviderManager } from './model.js';
import { adaptTools, type ToolDefinitionMap } from './tool-adapter.js';
import type { ITool } from '../core/tools/ITool.js';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ToolCallRecord {
  name: string;
  args: unknown;
  result?: unknown;
  error?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GenerateTextOptions {
  model: string;
  prompt?: string;
  system?: string;
  messages?: Message[];
  tools?: ToolDefinitionMap;
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  baseUrl?: string;
}

export interface GenerateTextResult {
  text: string;
  usage: TokenUsage;
  toolCalls: ToolCallRecord[];
  finishReason: 'stop' | 'length' | 'tool-calls' | 'error';
}

/**
 * Stateless text generation. Creates a temporary provider, runs the LLM call,
 * and returns the complete result. Supports multi-step tool calling.
 */
export async function generateText(opts: GenerateTextOptions): Promise<GenerateTextResult> {
  const { providerId, modelId } = parseModelString(opts.model);
  const resolved = resolveProvider(providerId, modelId, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
  const manager = await createProviderManager(resolved);

  const provider = manager.getProvider(resolved.providerId);
  if (!provider) throw new Error(`Provider ${resolved.providerId} not available.`);

  // Build messages
  const messages: Array<Record<string, unknown>> = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  if (opts.messages) {
    for (const m of opts.messages) messages.push({ role: m.role, content: m.content });
  }
  if (opts.prompt) messages.push({ role: 'user', content: opts.prompt });

  const tools = adaptTools(opts.tools);
  const toolMap = new Map<string, ITool>();
  for (const t of tools) toolMap.set(t.name, t);

  const toolSchemas = tools.length > 0
    ? tools.map(t => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }))
    : undefined;

  const allToolCalls: ToolCallRecord[] = [];
  let totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const maxSteps = opts.maxSteps ?? 1;

  for (let step = 0; step < maxSteps; step++) {
    const response = await provider.generateCompletion(
      resolved.modelId,
      messages as any,
      {
        tools: toolSchemas,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
      } as any,
    );

    // Accumulate usage
    if (response.usage) {
      totalUsage.promptTokens += response.usage.promptTokens ?? 0;
      totalUsage.completionTokens += response.usage.completionTokens ?? 0;
      totalUsage.totalTokens += response.usage.totalTokens ?? 0;
    }

    const choice = response.choices?.[0];
    if (!choice) break;

    const content = choice.message?.content;
    const textContent = typeof content === 'string' ? content : (content as any)?.text ?? '';
    const toolCallsInChoice = choice.message?.tool_calls ?? [];

    // If assistant returned text with no tool calls, we're done
    if (textContent && toolCallsInChoice.length === 0) {
      return {
        text: textContent,
        usage: totalUsage,
        toolCalls: allToolCalls,
        finishReason: (choice.finishReason ?? 'stop') as GenerateTextResult['finishReason'],
      };
    }

    // Tool calls
    if (toolCallsInChoice.length > 0) {
      messages.push({
        role: 'assistant',
        content: textContent || null,
        tool_calls: toolCallsInChoice,
      } as any);

      for (const tc of toolCallsInChoice) {
        const fnName = (tc as any).function?.name ?? (tc as any).name ?? '';
        const fnArgs = (tc as any).function?.arguments ?? '{}';
        const tcId = (tc as any).id ?? '';
        const tool = toolMap.get(fnName);
        const record: ToolCallRecord = {
          name: fnName,
          args: JSON.parse(typeof fnArgs === 'string' ? fnArgs : JSON.stringify(fnArgs)),
        };

        if (tool) {
          try {
            const result = await tool.execute(record.args as any, {} as any);
            record.result = result.output;
            record.error = result.success ? undefined : result.error;
            messages.push({
              role: 'tool',
              tool_call_id: tcId,
              content: JSON.stringify(result.output ?? result.error ?? ''),
            } as any);
          } catch (err: any) {
            record.error = err?.message;
            messages.push({ role: 'tool', tool_call_id: tcId, content: JSON.stringify({ error: err?.message }) } as any);
          }
        }
        allToolCalls.push(record);
      }
      continue;
    }

    // No content and no tool calls — done
    return {
      text: textContent,
      usage: totalUsage,
      toolCalls: allToolCalls,
      finishReason: (choice.finishReason ?? 'stop') as GenerateTextResult['finishReason'],
    };
  }

  // Exhausted maxSteps — return last state
  const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
  return {
    text: (lastAssistant?.content as string) ?? '',
    usage: totalUsage,
    toolCalls: allToolCalls,
    finishReason: 'tool-calls',
  };
}
