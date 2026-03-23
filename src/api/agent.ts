// packages/agentos/src/api/agent.ts
import { generateText, type GenerateTextOptions, type GenerateTextResult, type Message } from './generateText.js';
import { streamText, type StreamTextResult } from './streamText.js';
import type { ToolDefinitionMap } from './tool-adapter.js';

export interface AgentOptions {
  model: string;
  name?: string;
  instructions?: string;
  tools?: ToolDefinitionMap;
  memory?: boolean;
  personality?: Partial<{
    honesty: number; emotionality: number; extraversion: number;
    agreeableness: number; conscientiousness: number; openness: number;
  }>;
  guardrails?: string[];
  apiKey?: string;
  baseUrl?: string;
  maxSteps?: number;
}

export interface AgentSession {
  readonly id: string;
  send(text: string): Promise<GenerateTextResult>;
  stream(text: string): StreamTextResult;
  messages(): Message[];
  clear(): void;
}

export interface Agent {
  generate(prompt: string, opts?: Partial<GenerateTextOptions>): Promise<GenerateTextResult>;
  stream(prompt: string, opts?: Partial<GenerateTextOptions>): StreamTextResult;
  session(id?: string): AgentSession;
  close(): Promise<void>;
}

/**
 * Creates a stateful agent with sessions, memory, and personality.
 */
export function agent(opts: AgentOptions): Agent {
  const sessions = new Map<string, Message[]>();

  const baseOpts: Partial<GenerateTextOptions> = {
    model: opts.model,
    system: opts.instructions,
    tools: opts.tools,
    maxSteps: opts.maxSteps ?? 5,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  };

  return {
    async generate(prompt: string, extra?: Partial<GenerateTextOptions>): Promise<GenerateTextResult> {
      return generateText({ ...baseOpts, ...extra, prompt } as GenerateTextOptions);
    },

    stream(prompt: string, extra?: Partial<GenerateTextOptions>): StreamTextResult {
      return streamText({ ...baseOpts, ...extra, prompt } as GenerateTextOptions);
    },

    session(id?: string): AgentSession {
      const sessionId = id ?? `session-${Date.now()}`;
      if (!sessions.has(sessionId)) sessions.set(sessionId, []);
      const history = sessions.get(sessionId)!;

      return {
        id: sessionId,

        async send(text: string): Promise<GenerateTextResult> {
          history.push({ role: 'user', content: text });
          const result = await generateText({
            ...baseOpts,
            messages: [...history],
          } as GenerateTextOptions);
          history.push({ role: 'assistant', content: result.text });
          return result;
        },

        stream(text: string): StreamTextResult {
          history.push({ role: 'user', content: text });
          const result = streamText({
            ...baseOpts,
            messages: [...history],
          } as GenerateTextOptions);
          // Capture text for history when done
          result.text.then(t => history.push({ role: 'assistant', content: t }));
          return result;
        },

        messages(): Message[] {
          return [...history];
        },

        clear() {
          history.length = 0;
        },
      };
    },

    async close() {
      sessions.clear();
    },
  };
}
