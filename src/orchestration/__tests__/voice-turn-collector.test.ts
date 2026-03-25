/**
 * @file voice-turn-collector.test.ts
 * @description Unit tests for VoiceTurnCollector — covers transcript buffering,
 * turn counting, last-speaker tracking, GraphEvent emission, and checkpoint restore.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { VoiceTurnCollector } from '../runtime/VoiceTurnCollector.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fresh session emitter, event sink spy, and collector instance.
 *
 * @param initialTurnCount - Optional seed for checkpoint-restore tests.
 */
function setup(initialTurnCount = 0) {
  const session = new EventEmitter();
  const events: any[] = [];
  const sink = (evt: any) => events.push(evt);
  const collector = new VoiceTurnCollector(session, sink, 'test-node', initialTurnCount);
  return { session, events, collector };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VoiceTurnCollector', () => {
  it('emits voice_transcript on interim_transcript', () => {
    const { session, events } = setup();
    session.emit('interim_transcript', { text: 'Hel', confidence: 0.5 });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('voice_transcript');
    expect(events[0].isFinal).toBe(false);
  });

  it('sets nodeId on interim_transcript event', () => {
    const { session, events } = setup();
    session.emit('interim_transcript', { text: 'Hi' });
    expect(events[0].nodeId).toBe('test-node');
  });

  it('forwards text and confidence on interim_transcript', () => {
    const { session, events } = setup();
    session.emit('interim_transcript', { text: 'Hel', speaker: 'Speaker_1', confidence: 0.75 });
    expect(events[0].text).toBe('Hel');
    expect(events[0].confidence).toBe(0.75);
    expect(events[0].speaker).toBe('Speaker_1');
  });

  it('does NOT buffer interim transcripts', () => {
    const { session, collector } = setup();
    session.emit('interim_transcript', { text: 'part' });
    expect(collector.getTranscript()).toHaveLength(0);
  });

  it('buffers transcript on final_transcript', () => {
    const { session, collector } = setup();
    session.emit('final_transcript', { text: 'Hello', speaker: 'Speaker_0', confidence: 0.95 });
    expect(collector.getTranscript()).toHaveLength(1);
    expect(collector.getTranscript()[0].text).toBe('Hello');
    expect(collector.getLastSpeaker()).toBe('Speaker_0');
  });

  it('emits final voice_transcript on final_transcript', () => {
    const { session, events } = setup();
    session.emit('final_transcript', { text: 'Hello', speaker: 'Speaker_0', confidence: 0.95 });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('voice_transcript');
    expect(events[0].isFinal).toBe(true);
    expect(events[0].text).toBe('Hello');
  });

  it('accumulates multiple final transcript entries in order', () => {
    const { session, collector } = setup();
    session.emit('final_transcript', { text: 'Hello', speaker: 'Speaker_0' });
    session.emit('final_transcript', { text: 'World', speaker: 'Speaker_1' });
    const t = collector.getTranscript();
    expect(t).toHaveLength(2);
    expect(t[0].text).toBe('Hello');
    expect(t[1].text).toBe('World');
  });

  it('increments turn count on turn_complete', () => {
    const { session, collector } = setup();
    session.emit('turn_complete', { transcript: 'Hello there', reason: 'punctuation' });
    expect(collector.getTurnCount()).toBe(1);
  });

  it('emits voice_turn_complete with correct turnIndex and endpointReason', () => {
    const { session, events } = setup();
    session.emit('turn_complete', { transcript: 'Hello there', reason: 'punctuation' });
    expect(events[0].type).toBe('voice_turn_complete');
    expect(events[0].turnIndex).toBe(1);
    expect(events[0].endpointReason).toBe('punctuation');
    expect(events[0].transcript).toBe('Hello there');
  });

  it('increments turn count across multiple turn_complete events', () => {
    const { session, events, collector } = setup();
    session.emit('turn_complete', { reason: 'silence' });
    session.emit('turn_complete', { reason: 'silence' });
    session.emit('turn_complete', { reason: 'silence' });
    expect(collector.getTurnCount()).toBe(3);
    expect(events[2].turnIndex).toBe(3);
  });

  it('emits voice_barge_in on barge_in', () => {
    const { session, events } = setup();
    session.emit('barge_in', { interruptedText: 'I was saying', userSpeech: 'Wait!' });
    expect(events[0].type).toBe('voice_barge_in');
    expect(events[0].interruptedText).toBe('I was saying');
    expect(events[0].userSpeech).toBe('Wait!');
    expect(events[0].nodeId).toBe('test-node');
  });

  it('supports initial turn count for checkpoint restore', () => {
    const { session, collector } = setup(5);
    session.emit('turn_complete', { transcript: 'Next', reason: 'silence' });
    expect(collector.getTurnCount()).toBe(6);
  });

  it('emits correct turnIndex after checkpoint restore', () => {
    const { session, events } = setup(5);
    session.emit('turn_complete', { reason: 'silence' });
    expect(events[0].turnIndex).toBe(6);
  });

  it('defaults speaker to user when not provided on final_transcript', () => {
    const { session, collector } = setup();
    session.emit('final_transcript', { text: 'Hi' });
    expect(collector.getLastSpeaker()).toBe('user');
    expect(collector.getTranscript()[0].speaker).toBe('user');
  });

  it('returns empty transcript initially', () => {
    const { collector } = setup();
    expect(collector.getTranscript()).toEqual([]);
    expect(collector.getTurnCount()).toBe(0);
    expect(collector.getLastSpeaker()).toBe('');
  });

  it('getTranscript() returns a copy — mutations do not affect internal buffer', () => {
    const { session, collector } = setup();
    session.emit('final_transcript', { text: 'Immutable', speaker: 'user' });
    const copy = collector.getTranscript();
    copy.push({ speaker: 'intruder', text: 'injected', timestamp: 0 });
    expect(collector.getTranscript()).toHaveLength(1);
  });

  it('defaults missing barge_in fields to empty strings', () => {
    const { session, events } = setup();
    session.emit('barge_in', {});
    expect(events[0].interruptedText).toBe('');
    expect(events[0].userSpeech).toBe('');
  });

  it('defaults missing turn_complete reason to unknown', () => {
    const { session, events } = setup();
    session.emit('turn_complete', {});
    expect(events[0].endpointReason).toBe('unknown');
  });
});
