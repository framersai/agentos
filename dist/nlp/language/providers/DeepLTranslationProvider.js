import axios from 'axios';
export class DeepLTranslationProvider {
    constructor(id, params) {
        this.isInitialized = false;
        this.id = id;
        this.params = params;
    }
    async initialize() {
        if (!this.params.apiKey)
            throw new Error('DeepLTranslationProvider: apiKey missing');
        this.isInitialized = true;
    }
    async translate(input, source, target, _options) {
        const endpoint = this.params.endpoint || 'https://api.deepl.com/v2/translate';
        try {
            const resp = await axios.post(endpoint, null, {
                params: { auth_key: this.params.apiKey, text: input, source_lang: source.toUpperCase(), target_lang: target.toUpperCase() },
            });
            const out = resp.data?.translations?.[0]?.text ?? input;
            return { output: out, providerId: this.id, sourceLanguage: source, targetLanguage: target, providerMetadata: { character_count: resp.data?.character_count } };
        }
        catch (err) {
            return { output: input, providerId: this.id, sourceLanguage: source, targetLanguage: target, providerMetadata: { error: err.message } };
        }
    }
    async shutdown() { }
}
//# sourceMappingURL=DeepLTranslationProvider.js.map