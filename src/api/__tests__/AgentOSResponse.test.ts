import { describe, expect, it } from 'vitest';

import {
  AgentOSResponseChunkType,
  isActionableToolCallRequestChunk,
  isToolCallRequestChunk,
} from '../types/AgentOSResponse';

describe('AgentOSResponse helpers', () => {
  it('detects tool-call request chunks', () => {
    const chunk = {
      type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
      streamId: 'stream-1',
      gmiInstanceId: 'gmi-1',
      personaId: 'persona-1',
      isFinal: false,
      timestamp: new Date().toISOString(),
      toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'search', arguments: '{}' } }],
      executionMode: 'internal',
      requiresExternalToolResult: false,
    };

    expect(isToolCallRequestChunk(chunk)).toBe(true);
  });

  it('rejects non-tool-call chunks', () => {
    const chunk = {
      type: AgentOSResponseChunkType.TEXT_DELTA,
      streamId: 'stream-1',
      gmiInstanceId: 'gmi-1',
      personaId: 'persona-1',
      isFinal: false,
      timestamp: new Date().toISOString(),
      textDelta: 'hello',
    };

    expect(isToolCallRequestChunk(chunk)).toBe(false);
    expect(isToolCallRequestChunk(null)).toBe(false);
  });

  it('detects actionable external tool-call request chunks', () => {
    const chunk = {
      type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
      streamId: 'stream-1',
      gmiInstanceId: 'gmi-1',
      personaId: 'persona-1',
      isFinal: false,
      timestamp: new Date().toISOString(),
      toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'search', arguments: '{}' } }],
      executionMode: 'external',
      requiresExternalToolResult: true,
    };

    expect(isActionableToolCallRequestChunk(chunk)).toBe(true);
  });

  it('rejects informational or inconsistent tool-call request chunks', () => {
    const internalChunk = {
      type: AgentOSResponseChunkType.TOOL_CALL_REQUEST,
      streamId: 'stream-1',
      gmiInstanceId: 'gmi-1',
      personaId: 'persona-1',
      isFinal: false,
      timestamp: new Date().toISOString(),
      toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'search', arguments: '{}' } }],
      executionMode: 'internal',
      requiresExternalToolResult: false,
    };
    const inconsistentChunk = {
      ...internalChunk,
      executionMode: 'external',
      requiresExternalToolResult: false,
    };

    expect(isActionableToolCallRequestChunk(internalChunk)).toBe(false);
    expect(isActionableToolCallRequestChunk(inconsistentChunk)).toBe(false);
  });
});
