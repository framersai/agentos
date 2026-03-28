import axios from 'axios';
import { ITranslationProvider, TranslationOptions, TranslationResult } from '../interfaces';

interface DeepLProviderParams {
  apiKey: string;
  endpoint?: string; // default https://api.deepl.com/v2/translate
}

export class DeepLTranslationProvider implements ITranslationProvider {
  public readonly id: string;
  public isInitialized = false;
  private params: DeepLProviderParams;

  constructor(id: string, params: DeepLProviderParams) {
    this.id = id;
    this.params = params;
  }

  async initialize(): Promise<void> {
    if (!this.params.apiKey) throw new Error('DeepLTranslationProvider: apiKey missing');
    this.isInitialized = true;
  }

  async translate(input: string, source: string, target: string, _options?: TranslationOptions): Promise<TranslationResult> {
    const endpoint = this.params.endpoint || 'https://api.deepl.com/v2/translate';
    try {
      const resp = await axios.post(endpoint, null, {
        params: { auth_key: this.params.apiKey, text: input, source_lang: source.toUpperCase(), target_lang: target.toUpperCase() },
      });
      const out = resp.data?.translations?.[0]?.text ?? input;
      return { output: out, providerId: this.id, sourceLanguage: source, targetLanguage: target, providerMetadata: { character_count: resp.data?.character_count } };
    } catch (err: any) {
      return { output: input, providerId: this.id, sourceLanguage: source, targetLanguage: target, providerMetadata: { error: err.message } };
    }
  }
  async shutdown() { /* noop */ }
}
