import { describe, it, expect, vi } from 'vitest';

import { AgentOSOrchestrator } from '../../../src/api/AgentOSOrchestrator';
import { AgentOSResponseChunkType } from '../../../src/api/types/AgentOSResponse';
import { WorkflowStatus } from '../../../src/core/workflows/WorkflowTypes';

describe('AgentOSOrchestrator workflow broadcasting', () => {
  it('pushes workflow updates to active streams with metadata', async () => {
    const pushChunk = vi.fn(async () => {});

    const orchestrator = new AgentOSOrchestrator();
    await orchestrator.initialize(
      {},
      {
        gmiManager: {} as any,
        toolOrchestrator: {} as any,
        conversationManager: {} as any,
        streamingManager: {
          pushChunk,
          createStream: vi.fn(),
          registerClient: vi.fn(),
          deregisterClient: vi.fn(),
          closeStream: vi.fn(),
          getActiveStreamIds: vi.fn(),
        } as any,
        workflowEngine: {} as any,
      },
    );

    const activeContexts = (orchestrator as any).activeStreamContexts as Map<string, any>;
    activeContexts.set('stream-1', {
      gmi: { getGMIId: () => 'gmi-1' },
      userId: 'user-1',
      sessionId: 'session-1',
      personaId: 'persona-1',
      conversationId: 'conv-1',
      conversationContext: { toJSON: () => ({}) },
    });

    const workflowUpdate = {
      workflow: {
        workflowId: 'wf-1',
        definitionId: 'def-1',
        definitionVersion: '1.0.0',
        status: WorkflowStatus.RUNNING,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        conversationId: 'conv-1',
        createdByUserId: 'user-1',
        context: {},
        roleAssignments: {},
        tasks: {},
        metadata: {},
      },
      recentEvents: [],
    };

    await orchestrator.broadcastWorkflowUpdate(workflowUpdate);

    expect(pushChunk).toHaveBeenCalledTimes(1);
    const [streamId, chunk] = pushChunk.mock.calls[0];
    expect(streamId).toBe('stream-1');
    expect(chunk.type).toBe(AgentOSResponseChunkType.WORKFLOW_UPDATE);
    expect(chunk.workflow).toEqual(workflowUpdate);
    expect(chunk.metadata).toEqual({
      workflowId: 'wf-1',
      definitionId: 'def-1',
      conversationId: 'conv-1',
      status: WorkflowStatus.RUNNING,
    });
    expect(chunk.personaId).toBe('persona-1');
    expect(chunk.gmiInstanceId).toBe('gmi-1');
  });
});

