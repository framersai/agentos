import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AzureSpeechTTSProvider } from '../providers/AzureSpeechTTSProvider.js';

/** Minimal fake MP3 bytes for mocking the synthesis response. */
const FAKE_AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0x00]).buffer;

function makeAudioFetch(status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: vi.fn().mockResolvedValue(FAKE_AUDIO),
    text: vi.fn().mockResolvedValue('error text'),
    json: vi.fn().mockResolvedValue({}),
  });
}

function makeVoiceListFetch(voices: object[] = [], status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(voices),
    text: vi.fn().mockResolvedValue('error'),
  });
}

describe('AzureSpeechTTSProvider', () => {
  let provider: AzureSpeechTTSProvider;
  let mockFetch: ReturnType<typeof makeAudioFetch>;

  beforeEach(() => {
    mockFetch = makeAudioFetch();
    provider = new AzureSpeechTTSProvider({
      key: 'azure-key',
      region: 'eastus',
      defaultVoice: 'en-US-JennyNeural',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
  });

  it('reports provider id, name, and streaming capability', () => {
    expect(provider.id).toBe('azure-speech-tts');
    expect(provider.supportsStreaming).toBe(true);
    expect(provider.getProviderName()).toBe('Azure Speech (TTS)');
  });

  it('posts to the correct Azure TTS endpoint for the configured region', async () => {
    await provider.synthesize('Hello world');

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://eastus.tts.speech.microsoft.com/cognitiveservices/v1');
  });

  it('sends the required Azure headers', async () => {
    await provider.synthesize('Hello world');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('azure-key');
    expect(headers['Content-Type']).toBe('application/ssml+xml');
    expect(headers['X-Microsoft-OutputFormat']).toBe('audio-24khz-96kbitrate-mono-mp3');
  });

  it('sends well-formed SSML with the default voice', async () => {
    await provider.synthesize('Hello world');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = init.body as string;
    expect(body).toContain('<speak version="1.0"');
    expect(body).toContain('xmlns="http://www.w3.org/2001/10/synthesis"');
    expect(body).toContain('<voice name="en-US-JennyNeural">');
    expect(body).toContain('Hello world');
    expect(body).toContain('</voice>');
    expect(body).toContain('</speak>');
  });

  it('uses the voice from options when provided', async () => {
    await provider.synthesize('Hi', { voice: 'en-GB-RyanNeural' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body as string).toContain('<voice name="en-GB-RyanNeural">');
  });

  it('escapes XML special characters in the text body', async () => {
    await provider.synthesize('<script>alert("xss")</script> & more');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = init.body as string;
    expect(body).toContain('&lt;script&gt;');
    expect(body).toContain('&amp;');
    expect(body).not.toContain('<script>');
  });

  it('returns the audio buffer wrapped in SpeechSynthesisResult', async () => {
    const result = await provider.synthesize('Hello world');

    expect(result.audioBuffer).toBeInstanceOf(Buffer);
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.voiceUsed).toBe('en-US-JennyNeural');
    expect(result.cost).toBe(0);
    expect(result.usage?.characters).toBe('Hello world'.length);
  });

  it('throws a descriptive error on non-2xx synthesis response', async () => {
    const errFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('Unauthorized'),
    });
    const errProvider = new AzureSpeechTTSProvider({
      key: 'bad',
      region: 'eastus',
      fetchImpl: errFetch as unknown as typeof fetch,
    });

    await expect(errProvider.synthesize('test')).rejects.toThrow(
      'Azure Speech TTS failed (401): Unauthorized'
    );
  });

  describe('listAvailableVoices()', () => {
    it('fetches from the voices/list endpoint', async () => {
      const voiceFetch = makeVoiceListFetch([]);
      const p = new AzureSpeechTTSProvider({
        key: 'k',
        region: 'westeurope',
        fetchImpl: voiceFetch as unknown as typeof fetch,
      });

      await p.listAvailableVoices();

      const [url, init] = voiceFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://westeurope.tts.speech.microsoft.com/cognitiveservices/voices/list'
      );
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['Ocp-Apim-Subscription-Key']).toBe('k');
    });

    it('maps Azure voice entries to SpeechVoice shape', async () => {
      const azureVoices = [
        {
          ShortName: 'en-US-JennyNeural',
          DisplayName: 'Jenny',
          LocaleName: 'en-US',
          Gender: 'Female',
          Name: 'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)',
          Status: 'GA',
        },
        {
          ShortName: 'de-DE-ConradNeural',
          DisplayName: 'Conrad',
          LocaleName: 'de-DE',
          Gender: 'Male',
          Name: 'Microsoft Server Speech Text to Speech Voice (de-DE, ConradNeural)',
          Status: 'GA',
        },
      ];
      const voiceFetch = makeVoiceListFetch(azureVoices);
      const p = new AzureSpeechTTSProvider({
        key: 'k',
        region: 'eastus',
        fetchImpl: voiceFetch as unknown as typeof fetch,
      });

      const voices = await p.listAvailableVoices();

      expect(voices).toHaveLength(2);
      expect(voices[0]).toMatchObject({
        id: 'en-US-JennyNeural',
        name: 'Jenny',
        gender: 'female',
        lang: 'en-US',
        provider: 'azure-speech-tts',
      });
      expect(voices[1].gender).toBe('male');
    });

    it('throws on non-2xx voice list response', async () => {
      const errFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Internal Server Error'),
      });
      const p = new AzureSpeechTTSProvider({
        key: 'k',
        region: 'eastus',
        fetchImpl: errFetch as unknown as typeof fetch,
      });

      await expect(p.listAvailableVoices()).rejects.toThrow(
        'Azure Speech voice list failed (500): Internal Server Error'
      );
    });
  });
});
