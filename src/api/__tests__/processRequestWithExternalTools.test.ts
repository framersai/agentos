import { describe, expect, it, vi } from 'vitest';

import { AgentOSServiceError } from '../errors';
import { processRequestWithExternalTools } from '../processRequestWithExternalTools';
import {
  AgentOSResponseChunkType,
  type AgentOSResponse,
} from '../types/AgentOSResponse';

function createChunk(
  chunk: Record<string, unknown>,
): AgentOSResponse {
  return {
    ...chunk,
    timestamp: new Date().toISOString(),
  } as AgentOSResponse;
}

async function collectStream(
  stream: AsyncIterable<AgentOSResponse>,
): Promise<AgentOSResponse[]> {
  const chunks: AgentOSResponse[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('processRequestWithExternalTools', () => {
  it('auto-resumes nested external tool pauses', async () => {
    const externalToolCallA = { id: 'tool-a', name: 'search_memory', arguments: { query: 'prefs' } };
    const externalToolCallB = { id: 'tool-b', name: 'open_profile', arguments: { userId: 'user-1' } };

    const agentos = {
      processRequest: vi.fn(async function* () {
        yield createChunk({
          type: AgentOSResponseChunkType.TEXT_DELTA,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: false,
          textDelta: 'Checking memory...',
        });
        yield createChunk({
          type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: false,
          toolCalls: [externalToolCallA],
          executionMode: 'external',
          requiresExternalToolResult: true,
        });
      }),
      handleToolResult: vi.fn(async function* (_streamId: string, toolCallId: string) {
        if (toolCallId === 'tool-a') {
          yield createChunk({
            type: AgentOSResponseChunkType.TOOL_RESULT_EMISSION,
            streamId: 'stream-1',
            gmiInstanceId: 'gmi-1',
            personaId: 'persona-1',
            isFinal: false,
            toolCallId: 'tool-a',
            toolName: 'search_memory',
            toolResult: { results: ['pref-a'] },
            isSuccess: true,
          });
          yield createChunk({
            type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
            streamId: 'stream-1',
            gmiInstanceId: 'gmi-1',
            personaId: 'persona-1',
            isFinal: false,
            toolCalls: [externalToolCallB],
            executionMode: 'external',
            requiresExternalToolResult: true,
          });
          return;
        }

        yield createChunk({
          type: AgentOSResponseChunkType.TOOL_RESULT_EMISSION,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: false,
          toolCallId: 'tool-b',
          toolName: 'open_profile',
          toolResult: { name: 'John' },
          isSuccess: true,
        });
        yield createChunk({
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: true,
          finalResponseText: 'Done.',
        });
      }),
    };

    const executeToolCall = vi.fn(async ({ toolCall }) => ({
      toolOutput: { handled: toolCall.id },
      isSuccess: true,
    }));

    const chunks = await collectStream(
      processRequestWithExternalTools(
        agentos as any,
        {
          userId: 'user-1',
          sessionId: 'session-1',
          textInput: 'Load my profile.',
        },
        executeToolCall,
      ),
    );

    expect(executeToolCall).toHaveBeenCalledTimes(2);
    expect(executeToolCall).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        streamId: 'stream-1',
        toolCall: externalToolCallA,
      }),
    );
    expect(executeToolCall).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        streamId: 'stream-1',
        toolCall: externalToolCallB,
      }),
    );
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      AgentOSResponseChunkType.TEXT_DELTA,
      AgentOSResponseChunkType.TOOL_CALL_REQUEST,
      AgentOSResponseChunkType.TOOL_RESULT_EMISSION,
      AgentOSResponseChunkType.TOOL_CALL_REQUEST,
      AgentOSResponseChunkType.TOOL_RESULT_EMISSION,
      AgentOSResponseChunkType.FINAL_RESPONSE,
    ]);
  });

  it('passes through informational internal tool-call chunks without invoking the handler', async () => {
    const agentos = {
      processRequest: async function* () {
        yield createChunk({
          type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: false,
          toolCalls: [{ id: 'tool-1', name: 'memory_search', arguments: { query: 'prefs' } }],
          executionMode: 'internal',
          requiresExternalToolResult: false,
        });
        yield createChunk({
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: true,
          finalResponseText: 'Internal tool completed.',
        });
      },
      handleToolResult: vi.fn(),
    };

    const executeToolCall = vi.fn();
    const chunks = await collectStream(
      processRequestWithExternalTools(
        agentos as any,
        {
          userId: 'user-1',
          sessionId: 'session-1',
          textInput: 'Use internal tools.',
        },
        executeToolCall,
      ),
    );

    expect(executeToolCall).not.toHaveBeenCalled();
    expect(chunks).toHaveLength(2);
    expect(chunks[0].type).toBe(AgentOSResponseChunkType.TOOL_CALL_REQUEST);
    expect(chunks[1].type).toBe(AgentOSResponseChunkType.FINAL_RESPONSE);
  });

  it('batches multiple actionable external tool calls when the runtime supports it', async () => {
    const agentos = {
      processRequest: async function* () {
        yield createChunk({
          type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: false,
          toolCalls: [
            { id: 'tool-1', name: 'memory_search', arguments: { query: 'prefs' } },
            { id: 'tool-2', name: 'open_profile', arguments: { userId: 'user-1' } },
          ],
          executionMode: 'external',
          requiresExternalToolResult: true,
        });
      },
      handleToolResult: vi.fn(),
      handleToolResults: vi.fn(async function* (_streamId: string, toolResults: any[]) {
        yield createChunk({
          type: AgentOSResponseChunkType.TOOL_RESULT_EMISSION,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: false,
          toolCallId: toolResults[0].toolCallId,
          toolName: toolResults[0].toolName,
          toolResult: toolResults[0].toolOutput,
          isSuccess: toolResults[0].isSuccess,
        });
        yield createChunk({
          type: AgentOSResponseChunkType.TOOL_RESULT_EMISSION,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: false,
          toolCallId: toolResults[1].toolCallId,
          toolName: toolResults[1].toolName,
          toolResult: toolResults[1].toolOutput,
          isSuccess: toolResults[1].isSuccess,
        });
        yield createChunk({
          type: AgentOSResponseChunkType.FINAL_RESPONSE,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: true,
          finalResponseText: `Handled ${toolResults.length} tools.`,
        });
      }),
    };

    const executeToolCall = vi.fn(async ({ toolCall }) => ({
      toolOutput: { handled: toolCall.id },
      isSuccess: true,
    }));

    const chunks = await collectStream(
      processRequestWithExternalTools(
        agentos as any,
        {
          userId: 'user-1',
          sessionId: 'session-1',
          textInput: 'Use two tools.',
        },
        executeToolCall,
      ),
    );

    expect(executeToolCall).toHaveBeenCalledTimes(2);
    expect(agentos.handleToolResult).not.toHaveBeenCalled();
    expect(agentos.handleToolResults).toHaveBeenCalledTimes(1);
    expect(agentos.handleToolResults).toHaveBeenCalledWith('stream-1', [
      {
        toolCallId: 'tool-1',
        toolName: 'memory_search',
        toolOutput: { handled: 'tool-1' },
        isSuccess: true,
        errorMessage: undefined,
      },
      {
        toolCallId: 'tool-2',
        toolName: 'open_profile',
        toolOutput: { handled: 'tool-2' },
        isSuccess: true,
        errorMessage: undefined,
      },
    ]);
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      AgentOSResponseChunkType.TOOL_CALL_REQUEST,
      AgentOSResponseChunkType.TOOL_RESULT_EMISSION,
      AgentOSResponseChunkType.TOOL_RESULT_EMISSION,
      AgentOSResponseChunkType.FINAL_RESPONSE,
    ]);
  });

  it('throws when a batched pause is sent to a runtime without handleToolResults', async () => {
    const agentos = {
      processRequest: async function* () {
        yield createChunk({
          type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
          streamId: 'stream-1',
          gmiInstanceId: 'gmi-1',
          personaId: 'persona-1',
          isFinal: false,
          toolCalls: [
            { id: 'tool-1', name: 'memory_search', arguments: { query: 'prefs' } },
            { id: 'tool-2', name: 'open_profile', arguments: { userId: 'user-1' } },
          ],
          executionMode: 'external',
          requiresExternalToolResult: true,
        });
      },
      handleToolResult: vi.fn(),
    };

    await expect(
      collectStream(
        processRequestWithExternalTools(
          agentos as any,
          {
            userId: 'user-1',
            sessionId: 'session-1',
            textInput: 'Use two tools.',
          },
          async () => ({ toolOutput: {} }),
        ),
      ),
    ).rejects.toBeInstanceOf(AgentOSServiceError);
  });
});
