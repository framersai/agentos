import { describe, it, expect } from 'vitest';
import { findSpeechProviderCatalogEntry, SPEECH_PROVIDER_CATALOG } from '../providerCatalog.js';

describe('providerCatalog', () => {
  it('deepgram-batch entry exists with streaming: false', () => {
    const entry = findSpeechProviderCatalogEntry('deepgram-batch');
    expect(entry).toBeDefined();
    expect(entry!.streaming).toBe(false);
    expect(entry!.kind).toBe('stt');
  });

  it('nvidia-nemo is marked available: false', () => {
    const entry = findSpeechProviderCatalogEntry('nvidia-nemo');
    expect(entry).toBeDefined();
    expect((entry as any).available).toBe(false);
  });

  it('coqui is marked available: false', () => {
    const entry = findSpeechProviderCatalogEntry('coqui');
    expect((entry as any).available).toBe(false);
  });

  it('bark is marked available: false', () => {
    const entry = findSpeechProviderCatalogEntry('bark');
    expect((entry as any).available).toBe(false);
  });

  it('styletts2 is marked available: false', () => {
    const entry = findSpeechProviderCatalogEntry('styletts2');
    expect((entry as any).available).toBe(false);
  });

  it('azure-speech-stt has streaming: false', () => {
    const entry = findSpeechProviderCatalogEntry('azure-speech-stt');
    expect(entry!.streaming).toBe(false);
  });

  it('openai-whisper still exists and works', () => {
    const entry = findSpeechProviderCatalogEntry('openai-whisper');
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe('stt');
  });
});
