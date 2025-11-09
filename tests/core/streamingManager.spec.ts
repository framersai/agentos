import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StreamingManager, type StreamingManagerConfig } from '../../src/core/streaming/StreamingManager';
import type { AgentOSResponse } from '../../src/api/types/AgentOSResponse';
import { AgentOSResponseChunkType } from '../../src/api/types/AgentOSResponse';
import type { IStreamClient } from '../../src/core/streaming/IStreamClient';

class TestClient implements IStreamClient {
  public readonly id: string;
  public readonly received: AgentOSResponse[] = [];
  public closedReason: string | undefined;
  public closeCalls = 0;

  constructor(id: string) {
    this.id = id;
  }

  async sendChunk(chunk: AgentOSResponse): Promise<void> {
    this.received.push(chunk);
  }

  async notifyStreamClosed(reason?: string): Promise<void> {
    this.closedReason = reason;
  }

  isActive(): boolean {
    return true;
  }

  async close(reason?: string): Promise<void> {
    this.closeCalls += 1;
    this.closedReason = reason;
  }
}

describe('StreamingManager', () => {
  let manager: StreamingManager;
  const baseConfig: StreamingManagerConfig = {
    maxConcurrentStreams: 10,
    maxClientsPerStream: 5,
    onClientSendErrorBehavior: 'log_and_continue',
  };

  beforeEach(async () => {
    manager = new StreamingManager();
    await manager.initialize(baseConfig);
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  const makeChunk = (streamId: string, overrides: Partial<AgentOSResponse> = {}): AgentOSResponse => ({
    type: AgentOSResponseChunkType.SYSTEM_PROGRESS,
    streamId,
    gmiInstanceId: 'gmi-test',
    personaId: 'persona-test',
    isFinal: false,
    timestamp: new Date().toISOString(),
    message: 'initialising',
    ...overrides,
  } as AgentOSResponse);

  it('delivers chunks to registered clients', async () => {
    const streamId = await manager.createStream();
    const client = new TestClient('client-1');
    await manager.registerClient(streamId, client);

    await manager.pushChunk(streamId, makeChunk(streamId));

    expect(client.received).toHaveLength(1);
    expect(client.received[0].type).toBe(AgentOSResponseChunkType.SYSTEM_PROGRESS);
  });

  it('closes streams and notifies clients', async () => {
    const streamId = await manager.createStream();
    const client = new TestClient('client-close');
    await manager.registerClient(streamId, client);

    await manager.closeStream(streamId, 'done');

    expect(client.closedReason).toContain('done');
    await expect(manager.getActiveStreamIds()).resolves.not.toContain(streamId);
  });

  it('deregisters a client that fails to send when configured', async () => {
    await manager.shutdown(true);
    await manager.initialize({ ...baseConfig, onClientSendErrorBehavior: 'deregister_client' });

    const streamId = await manager.createStream();
    const failingClient: IStreamClient = {
      id: 'failing-client',
      async sendChunk() {
        throw new Error('transport failure');
      },
      async notifyStreamClosed() {
        // no-op
      },
      isActive() {
        return true;
      },
    };

    await manager.registerClient(streamId, failingClient);

    await manager.pushChunk(streamId, makeChunk(streamId));

    await expect(manager.getClientCountForStream(streamId)).resolves.toBe(0);
  });

  it('pushes error chunks to registered clients via handleStreamError', async () => {
    const streamId = await manager.createStream();
    const client = new TestClient('client-error');
    await manager.registerClient(streamId, client);

    await manager.handleStreamError(streamId, new Error('boom'), false);

    expect(client.received).toHaveLength(1);
    expect(client.received[0].type).toBe(AgentOSResponseChunkType.ERROR);
    expect((client.received[0] as any).message).toContain('boom');
  });
});
