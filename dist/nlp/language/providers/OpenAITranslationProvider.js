import axios from 'axios';
export class OpenAITranslationProvider {
    constructor(id, params) {
        this.isInitialized = false;
        this.id = id;
        this.params = params;
    }
    async initialize() {
        if (!this.params.apiKey)
            throw new Error('OpenAITranslationProvider: apiKey missing');
        this.isInitialized = true;
    }
    async translate(input, source, target, options) {
        // NOTE: This is a placeholder mapping using an LLM completion style endpoint; real translation endpoint may differ.
        const systemPrompt = `You are a translation engine. Translate the user's text from ${source} to ${target}. Preserve meaning and formatting.` + (options?.domain ? ` Domain: ${options.domain}.` : '');
        const body = {
            model: this.params.model || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: input }
            ]
        };
        try {
            const resp = await axios.post(this.params.endpoint || 'https://api.openai.com/v1/chat/completions', body, { headers: { Authorization: `Bearer ${this.params.apiKey}`, 'Content-Type': 'application/json' } });
            const output = resp.data?.choices?.[0]?.message?.content ?? input;
            return { output, providerId: this.id, sourceLanguage: source, targetLanguage: target, providerMetadata: { usage: resp.data?.usage } };
        }
        catch (err) {
            return { output: input, providerId: this.id, sourceLanguage: source, targetLanguage: target, providerMetadata: { error: err.message } };
        }
    }
    async shutdown() { }
}
//# sourceMappingURL=OpenAITranslationProvider.js.map