import { describe, expect, it, vi } from 'vitest';

import {
  formatExternalToolsForOpenAI,
  formatToolDefinitionsForOpenAI,
  listExternalToolDefinitionsForLLM,
} from '../externalToolRegistry';

describe('externalToolRegistry', () => {
  it('returns only prompt-aware external tools as ToolDefinitionForLLM entries', () => {
    const registry = {
      open_profile: {
        description: 'Load a saved profile record by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'string' },
          },
          required: ['profileId'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            profile: { type: 'object' },
          },
        },
        execute: vi.fn(async () => ({
          success: true,
          output: { profile: { id: 'profile-1' } },
        })),
      },
      refresh_cache: async () => ({
        success: true,
        output: { refreshed: true },
      }),
    };

    expect(listExternalToolDefinitionsForLLM(registry)).toEqual([
      {
        name: 'open_profile',
        description: 'Load a saved profile record by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'string' },
          },
          required: ['profileId'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            profile: { type: 'object' },
          },
        },
      },
    ]);
  });

  it('formats prompt-aware external tools into OpenAI-compatible function schemas', () => {
    const definitions = listExternalToolDefinitionsForLLM({
      open_profile: {
        description: 'Load a saved profile record by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            profileId: { type: 'string' },
          },
          required: ['profileId'],
        },
        execute: vi.fn(async () => ({
          success: true,
          output: { profile: { id: 'profile-1' } },
        })),
      },
    });

    expect(formatToolDefinitionsForOpenAI(definitions)).toEqual([
      {
        type: 'function',
        function: {
          name: 'open_profile',
          description: 'Load a saved profile record by ID.',
          parameters: {
            type: 'object',
            properties: {
              profileId: { type: 'string' },
            },
            required: ['profileId'],
          },
        },
      },
    ]);

    expect(
      formatExternalToolsForOpenAI({
        open_profile: {
          description: 'Load a saved profile record by ID.',
          inputSchema: {
            type: 'object',
            properties: {
              profileId: { type: 'string' },
            },
            required: ['profileId'],
          },
          execute: vi.fn(async () => ({
            success: true,
            output: { profile: { id: 'profile-1' } },
          })),
        },
      })
    ).toEqual([
      {
        type: 'function',
        function: {
          name: 'open_profile',
          description: 'Load a saved profile record by ID.',
          parameters: {
            type: 'object',
            properties: {
              profileId: { type: 'string' },
            },
            required: ['profileId'],
          },
        },
      },
    ]);
  });
});
