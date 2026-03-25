/**
 * @file VoiceNodeExecutor.ts
 * @description Executes voice nodes in the orchestration graph by managing a voice
 * pipeline session, collecting turns via {@link VoiceTurnCollector}, and racing
 * multiple exit conditions (hangup, turns exhausted, keyword, silence timeout,
 * barge-in abort) to determine when the voice node completes.
 *
 * The executor follows the standard 2-arg `execute(node, state)` contract used by
 * {@link NodeExecutor}. It creates an internal `AbortController` for barge-in
 * support and optionally merges a parent abort signal from `state.scratch.abortSignal`.
 *
 * Voice transport and session references are expected in `state.scratch`:
 * - `voiceTransport` — the bidirectional transport EventEmitter (emits `close` / `disconnected`).
 * - `voiceTransport._voiceSession` — the voice pipeline session EventEmitter that fires
 *   `final_transcript`, `turn_complete`, `speech_start`, and `barge_in` events.
 *
 * Checkpoint data is stored in `state.scratch[nodeId]` as a {@link VoiceNodeCheckpoint},
 * enabling the graph runtime to resume a voice session from the exact turn index where
 * it was previously suspended.
 */

import { EventEmitter } from 'events';
import type { GraphNode, GraphState, VoiceNodeConfig } from '../ir/types.js';
import type { GraphEvent } from '../events/GraphEvent.js';
import type { NodeExecutionResult } from './NodeExecutor.js';
import { VoiceTurnCollector } from './VoiceTurnCollector.js';
import { VoiceInterruptError } from '../../voice-pipeline/VoiceInterruptError.js';

// ---------------------------------------------------------------------------
// Checkpoint type
// ---------------------------------------------------------------------------

/**
 * Checkpoint data stored in `state.scratch[nodeId]` after a voice node completes.
 *
 * The graph runtime persists this structure so that a subsequent invocation of the
 * same voice node (e.g. after a graph loop or checkpoint restore) can continue the
 * conversation from `turnIndex` rather than resetting to zero.
 */
export interface VoiceNodeCheckpoint {
  /** Number of turns completed when the checkpoint was captured. */
  turnIndex: number;
  /** Full transcript buffer at the time of checkpoint. */
  transcript: Array<{ speaker: string; text: string; timestamp: number }>;
  /** Exit reason that caused the voice node to complete (`null` if still in progress). */
  lastExitReason: string | null;
  /** Maps diarization speaker labels to human-readable names (reserved for future use). */
  speakerMap: Record<string, string>;
  /** The voice config that was active when this checkpoint was created. */
  sessionConfig: VoiceNodeConfig;
}

// ---------------------------------------------------------------------------
// VoiceNodeExecutor
// ---------------------------------------------------------------------------

/**
 * Executes voice-type graph nodes by running a voice pipeline session and racing
 * multiple exit conditions to determine when the node is done.
 *
 * Exit conditions are evaluated concurrently via a single `Promise` race:
 * - **Hangup** — transport emits `close` or `disconnected`.
 * - **Turns exhausted** — session emits `turn_complete` and the collector's count
 *   reaches `config.maxTurns`.
 * - **Keyword** — a `final_transcript` event contains one of `config.exitKeywords`.
 * - **Silence timeout** — no speech activity for 30 seconds (when `exitOn: 'silence-timeout'`).
 * - **Abort/barge-in** — the internal `AbortController` is signalled, either by a
 *   parent abort signal or a `VoiceInterruptError`.
 *
 * @example
 * ```ts
 * const executor = new VoiceNodeExecutor((event) => emitter.emit(event));
 * const result = await executor.execute(voiceNode, graphState);
 * console.log(result.output.exitReason); // 'turns-exhausted' | 'hangup' | 'keyword:goodbye' | ...
 * ```
 */
export class VoiceNodeExecutor {
  /**
   * @param eventSink - Callback invoked synchronously for every emitted {@link GraphEvent}.
   *                     Typically bound to the graph runtime's event emitter.
   */
  constructor(
    private readonly eventSink: (event: GraphEvent) => void,
  ) {}

  /**
   * Execute a voice node. Matches the standard 2-arg `execute(node, state)` signature
   * used throughout the orchestration runtime.
   *
   * Creates an internal `AbortController` for barge-in, wires up a
   * {@link VoiceTurnCollector} on the session, and races exit conditions to
   * determine when the node completes.
   *
   * @param node  - Immutable voice node descriptor from the compiled graph IR.
   * @param state - Current (partial) graph state threaded from the runtime.
   * @returns A {@link NodeExecutionResult} with transcript, exit reason, and optional route target.
   */
  async execute(
    node: GraphNode,
    state: Partial<GraphState>,
  ): Promise<NodeExecutionResult> {
    const config = node.executorConfig;
    if (config.type !== 'voice') {
      return { success: false, error: 'VoiceNodeExecutor received non-voice node' };
    }
    const voiceConfig = config.voiceConfig;

    // Internal AbortController for barge-in or parent cancellation.
    const controller = new AbortController();

    // If a parent abort signal exists in scratch, forward its abort to ours.
    const parentSignal = (state as any)?.scratch?.abortSignal as AbortSignal | undefined;
    if (parentSignal) {
      parentSignal.addEventListener('abort', () => controller.abort(parentSignal.reason), { once: true });
    }

    // Voice transport must be pre-placed in state.scratch by the graph runtime.
    const transport = (state as any)?.scratch?.voiceTransport as EventEmitter | undefined;
    if (!transport) {
      return { success: false, error: 'Voice node requires voiceTransport in state.scratch' };
    }

    // Check for checkpoint restore — continue from a prior turn index.
    const checkpoint = (state as any)?.scratch?.[node.id] as VoiceNodeCheckpoint | undefined;
    const initialTurnCount = checkpoint?.turnIndex ?? 0;

    // Emit session lifecycle event: started.
    this.eventSink({ type: 'voice_session', nodeId: node.id, action: 'started' });

    try {
      // The voice session EventEmitter is expected on transport._voiceSession.
      // In production this is the VoicePipelineSession; in tests it can be a plain EventEmitter.
      const session: EventEmitter = (transport as any)._voiceSession ?? new EventEmitter();

      // Create the turn collector — it subscribes to session events and buffers transcript.
      const collector = new VoiceTurnCollector(session, this.eventSink, node.id, initialTurnCount);

      // Race all exit conditions against each other.
      const result = await this.raceExitConditions(
        session,
        collector,
        voiceConfig,
        controller,
        transport,
      );

      // Resolve exitReason → routeTarget from node edges.
      const edges = (node as any).edges ?? {};
      const routeTarget = typeof edges === 'object' ? edges[result.reason] : undefined;

      // Build checkpoint for scratch so the runtime can persist/restore later.
      const voiceCheckpoint: VoiceNodeCheckpoint = {
        turnIndex: collector.getTurnCount(),
        transcript: collector.getTranscript(),
        lastExitReason: result.reason,
        speakerMap: {},
        sessionConfig: voiceConfig,
      };

      // Emit session lifecycle event: ended.
      this.eventSink({ type: 'voice_session', nodeId: node.id, action: 'ended', exitReason: result.reason });

      return {
        success: true,
        output: {
          transcript: collector.getTranscript(),
          turns: collector.getTurnCount(),
          exitReason: result.reason,
          lastSpeaker: collector.getLastSpeaker(),
          interruptedText: result.interruptedText,
        },
        routeTarget,
        scratchUpdate: { [node.id]: voiceCheckpoint },
      };
    } catch (err) {
      // VoiceInterruptError is a structured barge-in — treat as a successful exit
      // with exitReason: 'interrupted' so the graph can route accordingly.
      if (err instanceof VoiceInterruptError) {
        const edges = (node as any).edges ?? {};
        const routeTarget = edges['interrupted'];

        this.eventSink({ type: 'voice_session', nodeId: node.id, action: 'ended', exitReason: 'interrupted' });

        return {
          success: true,
          output: {
            transcript: [],
            turns: 0,
            exitReason: 'interrupted',
            interruptedText: err.interruptedText,
            userSpeech: err.userSpeech,
          },
          routeTarget,
        };
      }

      // Unhandled error — surface as a failed result.
      this.eventSink({ type: 'voice_session', nodeId: node.id, action: 'ended', exitReason: 'error' });
      return { success: false, error: String(err) };
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Races all configured exit conditions against each other and resolves with
   * the first one that fires.
   *
   * Listeners are attached to the session and transport EventEmitters. The
   * `AbortController` signal is also monitored — if it fires with a
   * {@link VoiceInterruptError} the Promise rejects (handled by the caller),
   * otherwise it resolves with `{ reason: 'interrupted' }`.
   *
   * @param session    - Voice pipeline session EventEmitter.
   * @param collector  - Active turn collector tracking turn count.
   * @param config     - Voice node configuration with exit settings.
   * @param controller - Internal AbortController for barge-in signalling.
   * @param transport  - Bidirectional transport EventEmitter.
   * @returns The winning exit condition's reason string and optional interrupted text.
   */
  private async raceExitConditions(
    session: EventEmitter,
    collector: VoiceTurnCollector,
    config: VoiceNodeConfig,
    controller: AbortController,
    transport: EventEmitter,
  ): Promise<{ reason: string; interruptedText?: string }> {
    return new Promise((resolve, reject) => {
      /** Prevent double-resolution from multiple conditions firing simultaneously. */
      let settled = false;

      /**
       * Settle the promise with a resolve value, guarding against double-settle.
       * @param result - The exit condition result.
       */
      const settleWith = (result: { reason: string; interruptedText?: string }): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      // -- Hangup: transport disconnects -----------------------------------
      const onDisconnect = (): void => settleWith({ reason: 'hangup' });
      transport.on('close', onDisconnect);
      transport.on('disconnected', onDisconnect);

      // -- Turns exhausted -------------------------------------------------
      if (config.maxTurns && config.maxTurns > 0) {
        session.on('turn_complete', () => {
          if (collector.getTurnCount() >= config.maxTurns!) {
            settleWith({ reason: 'turns-exhausted' });
          }
        });
      }

      // -- Keyword detection -----------------------------------------------
      if (config.exitOn === 'keyword' && config.exitKeywords?.length) {
        session.on('final_transcript', (evt: any) => {
          const text = (evt.text ?? '').toLowerCase();
          for (const kw of config.exitKeywords!) {
            if (text.includes(kw.toLowerCase())) {
              settleWith({ reason: `keyword:${kw}` });
              return;
            }
          }
        });
      }

      // -- Silence timeout (default 30 s) ----------------------------------
      if (config.exitOn === 'silence-timeout') {
        let silenceTimer: ReturnType<typeof setTimeout> | null = null;
        const timeoutMs = 30_000;

        /** Reset the silence watchdog — called on any speech activity. */
        const resetTimer = (): void => {
          if (silenceTimer) clearTimeout(silenceTimer);
          silenceTimer = setTimeout(() => settleWith({ reason: 'silence-timeout' }), timeoutMs);
        };

        session.on('speech_start', resetTimer);
        session.on('turn_complete', resetTimer);
        resetTimer(); // Start the initial timer immediately.
      }

      // -- Abort signal (barge-in or parent cancellation) ------------------
      controller.signal.addEventListener('abort', () => {
        const reason = controller.signal.reason;
        if (reason instanceof VoiceInterruptError) {
          reject(reason);
        } else {
          settleWith({ reason: 'interrupted' });
        }
      }, { once: true });
    });
  }
}
