import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CallManager } from '../../src/voice/CallManager';
import type { CallManagerEvent } from '../../src/voice/CallManager';
import type { IVoiceCallProvider } from '../../src/voice/IVoiceCallProvider';
import type {
  VoiceCallConfig,
  NormalizedCallEvent,
  WebhookContext,
  CallRecord,
} from '../../src/voice/types';

// ============================================================================
// Fixtures
// ============================================================================

const config: VoiceCallConfig = {
  provider: { provider: 'mock', config: {} },
  tts: { provider: 'openai', voice: 'alloy' },
  stt: { provider: 'whisper', language: 'en' },
};

function createMockProvider(overrides?: Partial<IVoiceCallProvider>): IVoiceCallProvider {
  return {
    name: 'mock',
    verifyWebhook: vi.fn().mockReturnValue({ valid: true }),
    parseWebhookEvent: vi.fn().mockReturnValue({ events: [] }),
    initiateCall: vi.fn().mockResolvedValue({
      providerCallId: 'prov-1',
      success: true,
    }),
    hangupCall: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeWebhookCtx(): WebhookContext {
  return {
    method: 'POST',
    url: 'http://localhost:3000/voice/webhook/mock',
    headers: {},
    body: '{}',
  };
}

function makeEvent(partial: Partial<NormalizedCallEvent> & { kind: NormalizedCallEvent['kind'] }): NormalizedCallEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    providerCallId: 'prov-1',
    timestamp: Date.now(),
    ...partial,
  } as NormalizedCallEvent;
}

// ============================================================================
// Tests
// ============================================================================

describe('CallManager', () => {
  let cm: CallManager;
  let mockProvider: IVoiceCallProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    cm = new CallManager(config);
    mockProvider = createMockProvider();
    cm.registerProvider(mockProvider);
  });

  afterEach(() => {
    cm.dispose();
    vi.useRealTimers();
  });

  // ── Provider Management ──────────────────────────────────────────────────

  describe('registerProvider', () => {
    it('registers a provider that can be retrieved by name', () => {
      const provider = cm.getProvider('mock');
      expect(provider).toBe(mockProvider);
    });

    it('overwrites a provider with the same name on re-register', () => {
      const second = createMockProvider();
      cm.registerProvider(second);
      expect(cm.getProvider('mock')).toBe(second);
    });

    it('returns the default provider when no name is specified', () => {
      expect(cm.getProvider()).toBe(mockProvider);
    });

    it('returns undefined for an unregistered provider name', () => {
      expect(cm.getProvider('twilio')).toBeUndefined();
    });
  });

  // ── initiateCall ─────────────────────────────────────────────────────────

  describe('initiateCall', () => {
    it('creates a call record in initiated state', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });

      expect(call.state).toBe('initiated');
      expect(call.direction).toBe('outbound');
      expect(call.toNumber).toBe('+15551234567');
      expect(call.mode).toBe('conversation');
      expect(call.providerCallId).toBe('prov-1');
      expect(call.transcript).toEqual([]);
      expect(call.callId).toBeDefined();
      expect(call.createdAt).toBeGreaterThan(0);
    });

    it('delegates to provider.initiateCall with correct parameters', async () => {
      await cm.initiateCall({ toNumber: '+15551234567', mode: 'notify', message: 'Hello' });

      expect(mockProvider.initiateCall).toHaveBeenCalledOnce();
      const input = (mockProvider.initiateCall as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(input.toNumber).toBe('+15551234567');
      expect(input.mode).toBe('notify');
      expect(input.message).toBe('Hello');
      expect(input.notifyVoice).toBe('alloy');
    });

    it('maps providerCallId for future lookups', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      const found = cm.findCallByProviderCallId('prov-1');
      expect(found).toBe(call);
    });

    it('emits call:initiated event on success', async () => {
      const handler = vi.fn();
      cm.on(handler);

      await cm.initiateCall({ toNumber: '+15551234567' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'call:initiated',
          callId: expect.any(String),
        }),
      );
    });

    it('transitions to failed when provider returns success: false', async () => {
      const failProvider = createMockProvider({
        initiateCall: vi.fn().mockResolvedValue({
          providerCallId: '',
          success: false,
          error: 'Rate limited',
        }),
      });
      cm.registerProvider(failProvider);

      const call = await cm.initiateCall({ toNumber: '+15551234567' });

      expect(call.state).toBe('failed');
      expect(call.errorMessage).toBe('Rate limited');
    });

    it('transitions to error when provider throws', async () => {
      const errorProvider = createMockProvider({
        initiateCall: vi.fn().mockRejectedValue(new Error('Network failure')),
      });
      cm.registerProvider(errorProvider);

      const call = await cm.initiateCall({ toNumber: '+15551234567' });

      expect(call.state).toBe('error');
      expect(call.errorMessage).toBe('Network failure');
    });

    it('throws when no provider is registered for the name', async () => {
      await expect(
        cm.initiateCall({ toNumber: '+15551234567', providerName: 'twilio' }),
      ).rejects.toThrow('No provider registered for "twilio"');
    });

    it('uses defaultMode from config when mode is not specified', async () => {
      const configWithDefault: VoiceCallConfig = {
        ...config,
        defaultMode: 'notify',
      };
      const mgr = new CallManager(configWithDefault);
      mgr.registerProvider(mockProvider);

      const call = await mgr.initiateCall({ toNumber: '+15551234567' });
      expect(call.mode).toBe('notify');
      mgr.dispose();
    });
  });

  // ── hangupCall ───────────────────────────────────────────────────────────

  describe('hangupCall', () => {
    it('transitions call to hangup-bot and sets endedAt', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      await cm.hangupCall(call.callId);

      const updated = cm.getCall(call.callId);
      expect(updated?.state).toBe('hangup-bot');
      expect(updated?.endedAt).toBeGreaterThan(0);
    });

    it('delegates to provider.hangupCall', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      await cm.hangupCall(call.callId);

      expect(mockProvider.hangupCall).toHaveBeenCalledWith({
        providerCallId: 'prov-1',
      });
    });

    it('emits call:ended event', async () => {
      const handler = vi.fn();
      cm.on(handler);

      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      handler.mockClear();
      await cm.hangupCall(call.callId);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'call:ended',
          callId: call.callId,
        }),
      );
    });

    it('no-ops if call is already in a terminal state', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      await cm.hangupCall(call.callId);
      (mockProvider.hangupCall as ReturnType<typeof vi.fn>).mockClear();

      // Second hangup should be a no-op
      await cm.hangupCall(call.callId);
      expect(mockProvider.hangupCall).not.toHaveBeenCalled();
    });

    it('no-ops if call does not exist', async () => {
      await cm.hangupCall('nonexistent-id');
      expect(mockProvider.hangupCall).not.toHaveBeenCalled();
    });

    it('still transitions even if provider.hangupCall throws', async () => {
      (mockProvider.hangupCall as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Provider down'),
      );

      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      await cm.hangupCall(call.callId);

      expect(cm.getCall(call.callId)?.state).toBe('hangup-bot');
    });
  });

  // ── speakText ────────────────────────────────────────────────────────────

  describe('speakText', () => {
    it('adds a bot transcript entry', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.speakText(call.callId, 'Hello caller');

      const updated = cm.getCall(call.callId);
      expect(updated?.transcript).toHaveLength(1);
      expect(updated?.transcript[0]).toEqual(
        expect.objectContaining({
          speaker: 'bot',
          text: 'Hello caller',
          isFinal: true,
        }),
      );
    });

    it('transitions to speaking state', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      // Advance the call to active first via normalized events
      cm.processNormalizedEvent(makeEvent({ kind: 'call-ringing', providerCallId: 'prov-1' }));
      cm.processNormalizedEvent(makeEvent({ kind: 'call-answered', providerCallId: 'prov-1' }));
      // conversation mode auto-transitions to active->listening

      cm.speakText(call.callId, 'Hi there');
      expect(cm.getCall(call.callId)?.state).toBe('speaking');
    });

    it('emits call:speaking event', async () => {
      const handler = vi.fn();
      cm.on(handler);

      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      handler.mockClear();

      cm.speakText(call.callId, 'Test');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'call:speaking',
          data: { text: 'Test' },
        }),
      );
    });

    it('no-ops if call is in a terminal state', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      await cm.hangupCall(call.callId);

      const handler = vi.fn();
      cm.on(handler);
      cm.speakText(call.callId, 'Should not work');

      expect(handler).not.toHaveBeenCalled();
      expect(cm.getCall(call.callId)?.transcript).toHaveLength(0);
    });

    it('no-ops for a nonexistent call', () => {
      // Should not throw
      cm.speakText('nonexistent', 'Hello');
    });
  });

  // ── processWebhook ──────────────────────────────────────────────────────

  describe('processWebhook', () => {
    it('verifies webhook and processes parsed events', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      (mockProvider.parseWebhookEvent as ReturnType<typeof vi.fn>).mockReturnValue({
        events: [
          makeEvent({ kind: 'call-ringing', providerCallId: 'prov-1' }),
        ],
      });

      cm.processWebhook('mock', makeWebhookCtx());

      expect(mockProvider.verifyWebhook).toHaveBeenCalled();
      expect(mockProvider.parseWebhookEvent).toHaveBeenCalled();
      expect(cm.getCall(call.callId)?.state).toBe('ringing');
    });

    it('skips processing if verification fails', async () => {
      (mockProvider.verifyWebhook as ReturnType<typeof vi.fn>).mockReturnValue({
        valid: false,
        error: 'Bad signature',
      });

      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processWebhook('mock', makeWebhookCtx());

      expect(mockProvider.parseWebhookEvent).not.toHaveBeenCalled();
      expect(cm.getCall(call.callId)?.state).toBe('initiated');
    });

    it('ignores unknown provider name', () => {
      // Should not throw
      cm.processWebhook('nonexistent', makeWebhookCtx());
    });
  });

  // ── processNormalizedEvent ──────────────────────────────────────────────

  describe('processNormalizedEvent', () => {
    it('transitions initiated -> ringing on call-ringing', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processNormalizedEvent(makeEvent({ kind: 'call-ringing', providerCallId: 'prov-1' }));
      expect(cm.getCall(call.callId)?.state).toBe('ringing');
    });

    it('call-answered in conversation mode auto-transitions to listening', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processNormalizedEvent(makeEvent({ kind: 'call-ringing', providerCallId: 'prov-1' }));
      cm.processNormalizedEvent(makeEvent({ kind: 'call-answered', providerCallId: 'prov-1' }));

      // Conversation mode auto-transitions: answered -> active -> listening
      expect(cm.getCall(call.callId)?.state).toBe('listening');
    });

    it('transitions to completed and sets endedAt', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processNormalizedEvent(makeEvent({ kind: 'call-completed', providerCallId: 'prov-1' }));

      const updated = cm.getCall(call.callId);
      expect(updated?.state).toBe('completed');
      expect(updated?.endedAt).toBeGreaterThan(0);
    });

    it('transitions to failed with reason', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processNormalizedEvent(
        makeEvent({ kind: 'call-failed', providerCallId: 'prov-1', reason: 'Carrier rejected' } as any),
      );

      const updated = cm.getCall(call.callId);
      expect(updated?.state).toBe('failed');
      expect(updated?.errorMessage).toBe('Carrier rejected');
    });

    it('transitions to busy', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processNormalizedEvent(makeEvent({ kind: 'call-busy', providerCallId: 'prov-1' }));
      expect(cm.getCall(call.callId)?.state).toBe('busy');
    });

    it('transitions to no-answer', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processNormalizedEvent(makeEvent({ kind: 'call-no-answer', providerCallId: 'prov-1' }));
      expect(cm.getCall(call.callId)?.state).toBe('no-answer');
    });

    it('transitions to voicemail', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processNormalizedEvent(makeEvent({ kind: 'call-voicemail', providerCallId: 'prov-1' }));
      expect(cm.getCall(call.callId)?.state).toBe('voicemail');
    });

    it('transitions to hangup-user', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processNormalizedEvent(makeEvent({ kind: 'call-hangup-user', providerCallId: 'prov-1' }));
      expect(cm.getCall(call.callId)?.state).toBe('hangup-user');
    });

    it('transitions to error with error message', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processNormalizedEvent(
        makeEvent({ kind: 'call-error', providerCallId: 'prov-1', error: 'Provider crash' } as any),
      );

      const updated = cm.getCall(call.callId);
      expect(updated?.state).toBe('error');
      expect(updated?.errorMessage).toBe('Provider crash');
    });

    it('adds transcript entry for final transcript events', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      // Advance to listening state first
      cm.processNormalizedEvent(makeEvent({ kind: 'call-ringing', providerCallId: 'prov-1' }));
      cm.processNormalizedEvent(makeEvent({ kind: 'call-answered', providerCallId: 'prov-1' }));

      cm.processNormalizedEvent(
        makeEvent({
          kind: 'transcript',
          providerCallId: 'prov-1',
          text: 'Hello agent',
          isFinal: true,
        } as any),
      );

      const updated = cm.getCall(call.callId);
      expect(updated?.transcript).toHaveLength(1);
      expect(updated?.transcript[0]).toEqual(
        expect.objectContaining({ speaker: 'user', text: 'Hello agent', isFinal: true }),
      );
    });

    it('does not add transcript for non-final transcript events', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processNormalizedEvent(makeEvent({ kind: 'call-ringing', providerCallId: 'prov-1' }));
      cm.processNormalizedEvent(makeEvent({ kind: 'call-answered', providerCallId: 'prov-1' }));

      cm.processNormalizedEvent(
        makeEvent({
          kind: 'transcript',
          providerCallId: 'prov-1',
          text: 'partial...',
          isFinal: false,
        } as any),
      );

      expect(cm.getCall(call.callId)?.transcript).toHaveLength(0);
    });

    it('sets streamSid on media-stream-connected', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processNormalizedEvent(
        makeEvent({
          kind: 'media-stream-connected',
          providerCallId: 'prov-1',
          streamSid: 'stream-abc',
        } as any),
      );

      expect(cm.getCall(call.callId)?.streamSid).toBe('stream-abc');
    });

    it('emits speech-start event', async () => {
      const handler = vi.fn();
      cm.on(handler);

      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      handler.mockClear();

      cm.processNormalizedEvent(makeEvent({ kind: 'speech-start', providerCallId: 'prov-1' }));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'call:speech-start',
          callId: call.callId,
        }),
      );
    });

    it('deduplicates events by eventId (idempotency)', async () => {
      const handler = vi.fn();
      cm.on(handler);

      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      handler.mockClear();

      const event = makeEvent({ kind: 'call-ringing', providerCallId: 'prov-1' });
      cm.processNormalizedEvent(event);
      cm.processNormalizedEvent(event); // duplicate

      const ringingCalls = handler.mock.calls.filter(
        ([e]: [CallManagerEvent]) => e.type === 'call:ringing',
      );
      expect(ringingCalls).toHaveLength(1);
    });

    it('ignores events for unknown providerCallId', () => {
      // Should not throw
      cm.processNormalizedEvent(makeEvent({ kind: 'call-ringing', providerCallId: 'unknown-xyz' }));
    });

    it('tracks processed event IDs on the call record', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      const event = makeEvent({ kind: 'call-ringing', providerCallId: 'prov-1' });
      cm.processNormalizedEvent(event);

      expect(cm.getCall(call.callId)?.processedEventIds).toContain(event.eventId);
    });
  });

  // ── State Machine (monotonic enforcement) ───────────────────────────────

  describe('state machine transitions', () => {
    it('prevents backward transitions (e.g., active -> ringing)', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processNormalizedEvent(makeEvent({ kind: 'call-ringing', providerCallId: 'prov-1' }));
      cm.processNormalizedEvent(makeEvent({ kind: 'call-answered', providerCallId: 'prov-1' }));
      // Now in 'listening' state (conversation mode auto-transition)

      // Try to go backward to ringing — should be a no-op
      cm.processNormalizedEvent(makeEvent({ kind: 'call-ringing', providerCallId: 'prov-1' }));
      expect(cm.getCall(call.callId)?.state).toBe('listening');
    });

    it('allows speaking <-> listening cycling', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processNormalizedEvent(makeEvent({ kind: 'call-ringing', providerCallId: 'prov-1' }));
      cm.processNormalizedEvent(makeEvent({ kind: 'call-answered', providerCallId: 'prov-1' }));
      // Now in listening state

      cm.speakText(call.callId, 'Hello');
      expect(cm.getCall(call.callId)?.state).toBe('speaking');

      // Transcript event transitions back to listening
      cm.processNormalizedEvent(
        makeEvent({ kind: 'transcript', providerCallId: 'prov-1', text: 'user reply', isFinal: true } as any),
      );
      expect(cm.getCall(call.callId)?.state).toBe('listening');

      // And back to speaking
      cm.speakText(call.callId, 'Response');
      expect(cm.getCall(call.callId)?.state).toBe('speaking');
    });

    it('terminal states can be reached from any non-terminal state', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      expect(cm.getCall(call.callId)?.state).toBe('initiated');

      // Jump directly to terminal (completed) from initiated
      cm.processNormalizedEvent(makeEvent({ kind: 'call-completed', providerCallId: 'prov-1' }));
      expect(cm.getCall(call.callId)?.state).toBe('completed');
    });

    it('no-ops when already in a terminal state', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processNormalizedEvent(makeEvent({ kind: 'call-completed', providerCallId: 'prov-1' }));

      // Try to transition to ringing — should be no-op
      cm.processNormalizedEvent(makeEvent({ kind: 'call-ringing', providerCallId: 'prov-1' }));
      expect(cm.getCall(call.callId)?.state).toBe('completed');
    });

    it('no-ops for same-state transitions', async () => {
      const handler = vi.fn();
      cm.on(handler);

      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      cm.processNormalizedEvent(makeEvent({ kind: 'call-ringing', providerCallId: 'prov-1' }));
      handler.mockClear();

      // Same state transition again — transitionState is a no-op so state won't change
      // but processNormalizedEvent still emits the event (the event is processed, just state doesn't change)
      cm.processNormalizedEvent(makeEvent({ kind: 'call-ringing', providerCallId: 'prov-1' }));
      expect(cm.getCall(call.callId)?.state).toBe('ringing');
    });
  });

  // ── Query Methods ──────────────────────────────────────────────────────

  describe('getCall', () => {
    it('returns a call by internal ID', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      expect(cm.getCall(call.callId)).toBe(call);
    });

    it('returns undefined for a nonexistent ID', () => {
      expect(cm.getCall('nonexistent')).toBeUndefined();
    });
  });

  describe('findCallByProviderCallId', () => {
    it('returns a call by provider-assigned ID', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      expect(cm.findCallByProviderCallId('prov-1')?.callId).toBe(call.callId);
    });

    it('returns undefined for unknown providerCallId', () => {
      expect(cm.findCallByProviderCallId('unknown')).toBeUndefined();
    });
  });

  describe('getActiveCalls', () => {
    it('returns all tracked calls', async () => {
      // Create two calls with unique providerCallIds
      let provCounter = 0;
      const multiProvider = createMockProvider({
        initiateCall: vi.fn().mockImplementation(async () => ({
          providerCallId: `prov-${++provCounter}`,
          success: true,
        })),
      });
      cm.registerProvider(multiProvider);

      await cm.initiateCall({ toNumber: '+15551111111' });
      await cm.initiateCall({ toNumber: '+15552222222' });

      const active = cm.getActiveCalls();
      expect(active).toHaveLength(2);
    });

    it('still includes calls briefly after terminal state (within 30s window)', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      await cm.hangupCall(call.callId);

      // Call is terminal but still in activeCalls for status queries
      expect(cm.getActiveCalls()).toHaveLength(1);
    });

    it('removes calls from activeCalls after 30s post-finalize', async () => {
      const call = await cm.initiateCall({ toNumber: '+15551234567' });
      await cm.hangupCall(call.callId);

      vi.advanceTimersByTime(30_001);

      expect(cm.getActiveCalls()).toHaveLength(0);
      expect(cm.getCall(call.callId)).toBeUndefined();
    });
  });

  // ── handleInboundCall ──────────────────────────────────────────────────

  describe('handleInboundCall', () => {
    it('returns null when inboundPolicy is disabled (default)', () => {
      const result = cm.handleInboundCall({
        providerCallId: 'inbound-1',
        provider: 'mock',
        fromNumber: '+15559999999',
        toNumber: '+15550000000',
      });
      expect(result).toBeNull();
    });

    it('creates inbound call in ringing state when policy is open', () => {
      const openCm = new CallManager({
        ...config,
        inboundPolicy: 'open',
      });
      openCm.registerProvider(mockProvider);

      const call = openCm.handleInboundCall({
        providerCallId: 'inbound-1',
        provider: 'mock',
        fromNumber: '+15559999999',
        toNumber: '+15550000000',
      });

      expect(call).not.toBeNull();
      expect(call!.state).toBe('ringing');
      expect(call!.direction).toBe('inbound');
      expect(call!.fromNumber).toBe('+15559999999');
      expect(call!.providerCallId).toBe('inbound-1');

      openCm.dispose();
    });

    it('allows numbers on the allowlist when policy is allowlist', () => {
      const allowlistCm = new CallManager({
        ...config,
        inboundPolicy: 'allowlist',
        allowedNumbers: ['+15559999999'],
      });
      allowlistCm.registerProvider(mockProvider);

      const allowed = allowlistCm.handleInboundCall({
        providerCallId: 'inbound-1',
        provider: 'mock',
        fromNumber: '+15559999999',
        toNumber: '+15550000000',
      });
      expect(allowed).not.toBeNull();

      const denied = allowlistCm.handleInboundCall({
        providerCallId: 'inbound-2',
        provider: 'mock',
        fromNumber: '+15558888888',
        toNumber: '+15550000000',
      });
      expect(denied).toBeNull();

      allowlistCm.dispose();
    });

    it('emits call:ringing event for accepted inbound calls', () => {
      const openCm = new CallManager({ ...config, inboundPolicy: 'open' });
      openCm.registerProvider(mockProvider);
      const handler = vi.fn();
      openCm.on(handler);

      openCm.handleInboundCall({
        providerCallId: 'inbound-1',
        provider: 'mock',
        fromNumber: '+15559999999',
        toNumber: '+15550000000',
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'call:ringing' }),
      );

      openCm.dispose();
    });

    it('maps providerCallId for inbound calls', () => {
      const openCm = new CallManager({ ...config, inboundPolicy: 'open' });
      openCm.registerProvider(mockProvider);

      const call = openCm.handleInboundCall({
        providerCallId: 'inbound-1',
        provider: 'mock',
        fromNumber: '+15559999999',
        toNumber: '+15550000000',
      });

      expect(openCm.findCallByProviderCallId('inbound-1')?.callId).toBe(call!.callId);

      openCm.dispose();
    });
  });

  // ── Event Handlers ─────────────────────────────────────────────────────

  describe('on (event handlers)', () => {
    it('returns an unsubscribe function', async () => {
      const handler = vi.fn();
      const unsub = cm.on(handler);

      await cm.initiateCall({ toNumber: '+15551234567' });
      expect(handler).toHaveBeenCalled();

      handler.mockClear();
      unsub();

      await cm.initiateCall({ toNumber: '+15552222222' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('handles errors in event handlers gracefully', async () => {
      const badHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler broke');
      });
      const goodHandler = vi.fn();

      cm.on(badHandler);
      cm.on(goodHandler);

      // Should not throw despite badHandler failing
      await cm.initiateCall({ toNumber: '+15551234567' });
      expect(goodHandler).toHaveBeenCalled();
    });

    it('handles async errors in event handlers gracefully', async () => {
      const asyncBadHandler = vi.fn().mockRejectedValue(new Error('Async error'));
      const goodHandler = vi.fn();

      cm.on(asyncBadHandler);
      cm.on(goodHandler);

      await cm.initiateCall({ toNumber: '+15551234567' });
      expect(goodHandler).toHaveBeenCalled();
    });
  });

  // ── dispose ────────────────────────────────────────────────────────────

  describe('dispose', () => {
    it('clears all internal state', async () => {
      await cm.initiateCall({ toNumber: '+15551234567' });
      cm.on(vi.fn());

      cm.dispose();

      expect(cm.getActiveCalls()).toHaveLength(0);
      expect(cm.getProvider('mock')).toBeUndefined();
      expect(cm.findCallByProviderCallId('prov-1')).toBeUndefined();
    });
  });
});
