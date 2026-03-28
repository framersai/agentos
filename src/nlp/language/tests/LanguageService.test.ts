import { describe, it, expect } from 'vitest';
import { LanguageService, AgentOSLanguageConfig } from '../LanguageService';

describe('LanguageService negotiation', () => {
  const baseConfig: AgentOSLanguageConfig = {
    defaultLanguage: 'en',
    supportedLanguages: ['en','es','fr','de'],
    fallbackLanguages: ['en'],
    pivotLanguage: 'en',
    autoDetect: true,
    preferSourceLanguageResponses: true,
  };

  it('prefers explicit user language when supported', async () => {
    const svc = new LanguageService(baseConfig);
    await svc.initialize();
    const result = svc.negotiate({
      explicitUserLanguage: 'fr',
      detectedLanguages: [{ code: 'es', confidence: 0.7 }],
      conversationPreferred: undefined,
      personaDefault: undefined,
      configDefault: 'en',
      supported: baseConfig.supportedLanguages,
      fallbackChain: baseConfig.fallbackLanguages!,
      preferSourceLanguageResponses: true,
      targetLanguage: undefined,
    } as any);
    expect(result.targetLanguage).toBe('fr');
    expect(result.sourceLanguage).toBe('fr');
  });

  it('uses detected language when no explicit provided', async () => {
    const svc = new LanguageService(baseConfig);
    await svc.initialize();
    const result = svc.negotiate({
      explicitUserLanguage: undefined,
      detectedLanguages: [{ code: 'es', confidence: 0.9 }],
      conversationPreferred: undefined,
      personaDefault: undefined,
      configDefault: 'en',
      supported: baseConfig.supportedLanguages,
      fallbackChain: baseConfig.fallbackLanguages!,
      preferSourceLanguageResponses: true,
      targetLanguage: undefined,
    } as any);
    expect(result.sourceLanguage).toBe('es');
    expect(result.targetLanguage).toBe('es');
  });

  it('falls back to default when unsupported detected', async () => {
    const svc = new LanguageService(baseConfig);
    await svc.initialize();
    const result = svc.negotiate({
      explicitUserLanguage: undefined,
      detectedLanguages: [{ code: 'it', confidence: 0.8 }],
      conversationPreferred: undefined,
      personaDefault: undefined,
      configDefault: 'en',
      supported: baseConfig.supportedLanguages,
      fallbackChain: baseConfig.fallbackLanguages!,
      preferSourceLanguageResponses: true,
      targetLanguage: undefined,
    } as any);
    expect(result.sourceLanguage).toBe('it');
    expect(result.targetLanguage).toBe('en');
    expect(result.negotiationPath).toContain('fallbackChain');
  });
});
