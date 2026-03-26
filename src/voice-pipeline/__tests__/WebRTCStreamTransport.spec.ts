/**
 * @module voice-pipeline/__tests__/WebRTCStreamTransport.spec
 *
 * Unit tests for {@link WebRTCStreamTransport}.
 *
 * Mock RTCPeerConnection and DataChannel objects simulate the WebRTC API
 * surface, allowing all channel events to be triggered synchronously.
 *
 * ## What is tested
 *
 * - Transport ID generation and initial state (`'connecting'`)
 * - DataChannel creation with correct options (audio: unreliable, control: reliable)
 * - Inbound binary messages on audio channel decoded as AudioFrame and emitted as 'audio_frame'
 * - Inbound text messages on control channel parsed as JSON and emitted as 'control'
 * - Non-binary messages on audio channel emit 'error' without crashing
 * - Malformed JSON on control channel emits 'error' without crashing
 * - sendAudio sends ArrayBuffer on audio DataChannel
 * - sendControl JSON-stringifies and sends on control DataChannel
 * - sendAudio/sendControl reject when channels are not open or initialized
 * - close() closes both channels and the peer connection
 * - State transitions: connecting -> open (both channels open) -> closing -> closed
 * - ICE candidate events are re-emitted as 'ice_candidate'
 * - Peer connection state changes map to transport events
 * - Remote DataChannel negotiation (ondatachannel)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WebRTCStreamTransport,
  type RTCPeerConnectionLike,
  type RTCDataChannelLike,
} from '../WebRTCStreamTransport.js';
import type { AudioFrame, EncodedAudioChunk } from '../types.js';

// ---------------------------------------------------------------------------
// Mock DataChannel factory
// ---------------------------------------------------------------------------

/**
 * Creates a mock RTCDataChannel that allows events to be triggered by
 * directly calling the `onXxx` handler properties.
 *
 * @param label - Channel label ('audio' or 'control').
 * @param opts - Channel creation options to store for assertion.
 */
function createMockDataChannel(label: string, opts?: Record<string, unknown>): RTCDataChannelLike & {
  _opts: Record<string, unknown> | undefined;
  _triggerOpen: () => void;
  _triggerClose: () => void;
  _triggerMessage: (data: unknown) => void;
  _triggerError: (event: Event) => void;
} {
  const channel: any = {
    label,
    readyState: 'connecting',
    binaryType: 'arraybuffer',
    _opts: opts,

    send: vi.fn(),
    close: vi.fn(() => {
      channel.readyState = 'closed';
    }),

    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,

    // Test helpers to trigger events
    _triggerOpen() {
      channel.readyState = 'open';
      if (channel.onopen) channel.onopen({} as Event);
    },
    _triggerClose() {
      channel.readyState = 'closed';
      if (channel.onclose) channel.onclose({} as Event);
    },
    _triggerMessage(data: unknown) {
      if (channel.onmessage) channel.onmessage({ data });
    },
    _triggerError(event: Event) {
      if (channel.onerror) channel.onerror(event);
    },
  };

  return channel;
}

// ---------------------------------------------------------------------------
// Mock RTCPeerConnection factory
// ---------------------------------------------------------------------------

/**
 * Creates a mock RTCPeerConnection that tracks DataChannel creation
 * and allows event triggers via handler properties.
 */
function createMockPC(): RTCPeerConnectionLike & {
  _channels: Map<string, ReturnType<typeof createMockDataChannel>>;
  _triggerConnectionState: (state: string) => void;
  _triggerIceCandidate: (candidate: unknown) => void;
  _triggerDataChannel: (channel: RTCDataChannelLike) => void;
} {
  const channels = new Map<string, ReturnType<typeof createMockDataChannel>>();

  const pc: any = {
    connectionState: 'new',
    _channels: channels,

    createDataChannel: vi.fn((label: string, opts?: Record<string, unknown>) => {
      const channel = createMockDataChannel(label, opts);
      channels.set(label, channel);
      return channel;
    }),

    addIceCandidate: vi.fn(async () => {}),
    close: vi.fn(() => { pc.connectionState = 'closed'; }),

    onicecandidate: null,
    onconnectionstatechange: null,
    ondatachannel: null,

    _triggerConnectionState(state: string) {
      pc.connectionState = state;
      if (pc.onconnectionstatechange) pc.onconnectionstatechange();
    },

    _triggerIceCandidate(candidate: unknown) {
      if (pc.onicecandidate) pc.onicecandidate({ candidate });
    },

    _triggerDataChannel(channel: RTCDataChannelLike) {
      if (pc.ondatachannel) pc.ondatachannel({ channel });
    },
  };

  return pc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebRTCStreamTransport', () => {
  let pc: ReturnType<typeof createMockPC>;
  let transport: WebRTCStreamTransport;

  beforeEach(async () => {
    pc = createMockPC();
    transport = new WebRTCStreamTransport(pc, { sampleRate: 16_000 });
    await transport.initialize();
  });

  // -------------------------------------------------------------------------
  // Identity and initial state
  // -------------------------------------------------------------------------

  it('should expose a non-empty string id (UUID)', () => {
    expect(typeof transport.id).toBe('string');
    expect(transport.id.length).toBeGreaterThan(0);
  });

  it('should start in "connecting" state before channels open', () => {
    expect(transport.state).toBe('connecting');
  });

  it('should throw if peerConnection is null', () => {
    expect(() => new WebRTCStreamTransport(null as any, { sampleRate: 16_000 }))
      .toThrow(/peerConnection is required/);
  });

  // -------------------------------------------------------------------------
  // DataChannel creation
  // -------------------------------------------------------------------------

  it('should create audio channel with unreliable/unordered options', () => {
    expect(pc.createDataChannel).toHaveBeenCalledWith('audio', {
      ordered: false,
      maxRetransmits: 0,
    });
  });

  it('should create control channel with ordered/reliable options', () => {
    expect(pc.createDataChannel).toHaveBeenCalledWith('control', {
      ordered: true,
    });
  });

  it('should set audio channel binaryType to arraybuffer', () => {
    const audioChannel = pc._channels.get('audio')!;
    expect(audioChannel.binaryType).toBe('arraybuffer');
  });

  // -------------------------------------------------------------------------
  // State transitions
  // -------------------------------------------------------------------------

  it('should transition to "open" when both channels open', () => {
    const listener = vi.fn();
    transport.on('connected', listener);

    const audioChannel = pc._channels.get('audio')!;
    const controlChannel = pc._channels.get('control')!;

    // Open audio first — should not yet trigger 'connected'
    audioChannel._triggerOpen();
    expect(transport.state).toBe('connecting');
    expect(listener).not.toHaveBeenCalled();

    // Open control second — now both are open
    controlChannel._triggerOpen();
    expect(transport.state).toBe('open');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should transition to "open" regardless of channel open order', () => {
    const listener = vi.fn();
    transport.on('connected', listener);

    const audioChannel = pc._channels.get('audio')!;
    const controlChannel = pc._channels.get('control')!;

    // Open control first this time
    controlChannel._triggerOpen();
    expect(transport.state).toBe('connecting');

    audioChannel._triggerOpen();
    expect(transport.state).toBe('open');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Inbound audio -> 'audio_frame'
  // -------------------------------------------------------------------------

  it('should emit "audio_frame" with correct AudioFrame when audio binary arrives', () => {
    const listener = vi.fn();
    transport.on('audio_frame', listener);

    const audioChannel = pc._channels.get('audio')!;

    // Create a 4-sample Float32Array and send its ArrayBuffer
    const samples = new Float32Array([0.1, -0.2, 0.3, -0.4]);
    audioChannel._triggerMessage(samples.buffer);

    expect(listener).toHaveBeenCalledTimes(1);
    const frame: AudioFrame = listener.mock.calls[0][0];
    expect(frame.sampleRate).toBe(16_000);
    expect(frame.samples.length).toBe(4);
    expect(frame.samples[0]).toBeCloseTo(0.1);
    expect(frame.samples[1]).toBeCloseTo(-0.2);
    expect(typeof frame.timestamp).toBe('number');
  });

  it('should emit "error" for non-binary messages on audio channel', () => {
    const errorListener = vi.fn();
    transport.on('error', errorListener);

    const audioChannel = pc._channels.get('audio')!;
    audioChannel._triggerMessage('not binary data');

    expect(errorListener).toHaveBeenCalledTimes(1);
    expect(errorListener.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(errorListener.mock.calls[0][0].message).toContain('non-binary');
  });

  // -------------------------------------------------------------------------
  // Inbound control -> 'control'
  // -------------------------------------------------------------------------

  it('should emit "control" with parsed JSON from control channel', () => {
    const listener = vi.fn();
    transport.on('control', listener);

    const controlChannel = pc._channels.get('control')!;
    const msg = { type: 'config', params: { sampleRate: 24000 } };
    controlChannel._triggerMessage(JSON.stringify(msg));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toEqual(msg);
  });

  it('should emit "error" for malformed JSON on control channel without crashing', () => {
    const errorListener = vi.fn();
    const controlListener = vi.fn();
    transport.on('error', errorListener);
    transport.on('control', controlListener);

    const controlChannel = pc._channels.get('control')!;
    controlChannel._triggerMessage('not valid json {{{');

    expect(errorListener).toHaveBeenCalledTimes(1);
    expect(errorListener.mock.calls[0][0].message).toContain('failed to parse control message');
    // Should not have emitted 'control'
    expect(controlListener).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // sendAudio
  // -------------------------------------------------------------------------

  it('should send ArrayBuffer on the audio channel for EncodedAudioChunk', async () => {
    const audioChannel = pc._channels.get('audio')!;
    const controlChannel = pc._channels.get('control')!;

    // Open both channels so sends succeed
    audioChannel._triggerOpen();
    controlChannel._triggerOpen();

    const chunk: EncodedAudioChunk = {
      audio: Buffer.from([1, 2, 3, 4]),
      format: 'pcm',
      sampleRate: 16_000,
      durationMs: 10,
      text: 'test',
    };

    await transport.sendAudio(chunk);
    expect(audioChannel.send).toHaveBeenCalledTimes(1);
    // Verify it sent an ArrayBuffer
    const sent = audioChannel.send.mock.calls[0][0];
    expect(sent).toBeInstanceOf(ArrayBuffer);
  });

  it('should send ArrayBuffer on the audio channel for AudioFrame', async () => {
    const audioChannel = pc._channels.get('audio')!;
    const controlChannel = pc._channels.get('control')!;
    audioChannel._triggerOpen();
    controlChannel._triggerOpen();

    const frame: AudioFrame = {
      samples: new Float32Array([0.5, -0.5]),
      sampleRate: 16_000,
      timestamp: Date.now(),
    };

    await transport.sendAudio(frame);
    expect(audioChannel.send).toHaveBeenCalledTimes(1);
    const sent = audioChannel.send.mock.calls[0][0];
    expect(sent).toBeInstanceOf(ArrayBuffer);
    // Verify the content matches
    const view = new Float32Array(sent);
    expect(view[0]).toBeCloseTo(0.5);
    expect(view[1]).toBeCloseTo(-0.5);
  });

  it('should reject sendAudio when audio channel is not initialized', async () => {
    // Create a fresh transport without calling initialize
    const freshTransport = new WebRTCStreamTransport(createMockPC(), { sampleRate: 16_000 });
    const frame: AudioFrame = {
      samples: new Float32Array([0.1]),
      sampleRate: 16_000,
      timestamp: Date.now(),
    };

    await expect(freshTransport.sendAudio(frame)).rejects.toThrow(/not initialized/);
  });

  it('should reject sendAudio when audio channel is not open', async () => {
    // Channels are created but still in 'connecting' state (not opened)
    const frame: AudioFrame = {
      samples: new Float32Array([0.1]),
      sampleRate: 16_000,
      timestamp: Date.now(),
    };

    await expect(transport.sendAudio(frame)).rejects.toThrow(/not "open"/);
  });

  // -------------------------------------------------------------------------
  // sendControl
  // -------------------------------------------------------------------------

  it('should JSON-stringify and send on the control channel', async () => {
    const audioChannel = pc._channels.get('audio')!;
    const controlChannel = pc._channels.get('control')!;
    audioChannel._triggerOpen();
    controlChannel._triggerOpen();

    const msg = { type: 'mute' as const };
    await transport.sendControl(msg);

    expect(controlChannel.send).toHaveBeenCalledWith(JSON.stringify(msg));
  });

  it('should reject sendControl when control channel is not initialized', async () => {
    const freshTransport = new WebRTCStreamTransport(createMockPC(), { sampleRate: 16_000 });
    await expect(freshTransport.sendControl({ type: 'mute' })).rejects.toThrow(/not initialized/);
  });

  it('should reject sendControl when control channel is not open', async () => {
    await expect(transport.sendControl({ type: 'mute' })).rejects.toThrow(/not "open"/);
  });

  // -------------------------------------------------------------------------
  // close()
  // -------------------------------------------------------------------------

  it('should close both channels and the peer connection', () => {
    const audioChannel = pc._channels.get('audio')!;
    const controlChannel = pc._channels.get('control')!;

    transport.close();

    expect(audioChannel.close).toHaveBeenCalled();
    expect(controlChannel.close).toHaveBeenCalled();
    expect(pc.close).toHaveBeenCalled();
    expect(transport.state).toBe('closed');
  });

  it('should emit "disconnected" on close', () => {
    const listener = vi.fn();
    transport.on('disconnected', listener);

    transport.close();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // ICE candidate handling
  // -------------------------------------------------------------------------

  it('should emit "ice_candidate" when local ICE candidate is available', () => {
    const listener = vi.fn();
    transport.on('ice_candidate', listener);

    const candidate = { candidate: 'candidate:1 1 UDP 2130706431 ...', sdpMid: 'data' };
    pc._triggerIceCandidate(candidate);

    expect(listener).toHaveBeenCalledWith(candidate);
  });

  it('should not emit "ice_candidate" for null candidates (end-of-candidates)', () => {
    const listener = vi.fn();
    transport.on('ice_candidate', listener);

    pc._triggerIceCandidate(null);
    expect(listener).not.toHaveBeenCalled();
  });

  it('should forward addIceCandidate to the peer connection', async () => {
    const candidate = { candidate: 'candidate:...' };
    await transport.addIceCandidate(candidate);
    expect(pc.addIceCandidate).toHaveBeenCalledWith(candidate);
  });

  // -------------------------------------------------------------------------
  // Peer connection state changes
  // -------------------------------------------------------------------------

  it('should emit "disconnected" and set state "closed" on peer connection failure', () => {
    const audioChannel = pc._channels.get('audio')!;
    const controlChannel = pc._channels.get('control')!;
    audioChannel._triggerOpen();
    controlChannel._triggerOpen();

    const disconnectListener = vi.fn();
    const errorListener = vi.fn();
    transport.on('disconnected', disconnectListener);
    transport.on('error', errorListener);

    pc._triggerConnectionState('failed');

    expect(transport.state).toBe('closed');
    expect(disconnectListener).toHaveBeenCalledTimes(1);
    expect(errorListener).toHaveBeenCalledTimes(1);
    expect(errorListener.mock.calls[0][0].message).toContain('failed');
  });

  it('should emit error on "disconnected" connection state when transport is open', () => {
    const audioChannel = pc._channels.get('audio')!;
    const controlChannel = pc._channels.get('control')!;
    audioChannel._triggerOpen();
    controlChannel._triggerOpen();

    const errorListener = vi.fn();
    transport.on('error', errorListener);

    pc._triggerConnectionState('disconnected');

    // Should emit error about transient disconnection but NOT close the transport
    expect(errorListener).toHaveBeenCalledTimes(1);
    expect(errorListener.mock.calls[0][0].message).toContain('disconnected');
    // Transport state should still be 'open' — ICE may recover
    expect(transport.state).toBe('open');
  });

  // -------------------------------------------------------------------------
  // Remote DataChannel negotiation
  // -------------------------------------------------------------------------

  it('should attach handlers to remotely-created audio DataChannel', () => {
    const remoteAudioChannel = createMockDataChannel('audio');
    pc._triggerDataChannel(remoteAudioChannel);

    const listener = vi.fn();
    transport.on('audio_frame', listener);

    remoteAudioChannel.readyState = 'open';
    const samples = new Float32Array([0.42]);
    remoteAudioChannel._triggerMessage(samples.buffer);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].samples[0]).toBeCloseTo(0.42);
  });

  it('should attach handlers to remotely-created control DataChannel', () => {
    const remoteControlChannel = createMockDataChannel('control');
    pc._triggerDataChannel(remoteControlChannel);

    const listener = vi.fn();
    transport.on('control', listener);

    const msg = { type: 'stop', reason: 'done' };
    remoteControlChannel._triggerMessage(JSON.stringify(msg));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toEqual(msg);
  });

  // -------------------------------------------------------------------------
  // Audio channel unexpected close
  // -------------------------------------------------------------------------

  it('should transition to closed and emit disconnected when audio channel closes unexpectedly while open', () => {
    const audioChannel = pc._channels.get('audio')!;
    const controlChannel = pc._channels.get('control')!;
    audioChannel._triggerOpen();
    controlChannel._triggerOpen();
    expect(transport.state).toBe('open');

    const listener = vi.fn();
    transport.on('disconnected', listener);

    audioChannel._triggerClose();

    expect(transport.state).toBe('closed');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
