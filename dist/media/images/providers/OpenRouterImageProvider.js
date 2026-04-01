import { getImageProviderOptions, normalizeOutputFormat, parseDataUrl, } from '../IImageProvider.js';
export class OpenRouterImageProvider {
    constructor() {
        this.providerId = 'openrouter';
        this.isInitialized = false;
    }
    async initialize(config) {
        const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
        if (!apiKey) {
            throw new Error('OpenRouter image provider requires apiKey.');
        }
        this.config = {
            apiKey,
            baseURL: typeof config.baseURL === 'string' && config.baseURL.trim()
                ? config.baseURL.trim()
                : 'https://openrouter.ai/api/v1',
            defaultModelId: typeof config.defaultModelId === 'string' && config.defaultModelId.trim()
                ? config.defaultModelId.trim()
                : undefined,
            siteUrl: typeof config.siteUrl === 'string' && config.siteUrl.trim()
                ? config.siteUrl.trim()
                : undefined,
            appName: typeof config.appName === 'string' && config.appName.trim()
                ? config.appName.trim()
                : 'AgentOS',
        };
        this.defaultModelId = this.config.defaultModelId;
        this.isInitialized = true;
    }
    async generateImage(request) {
        if (!this.isInitialized) {
            throw new Error('OpenRouter image provider is not initialized.');
        }
        const providerOptions = getImageProviderOptions(this.providerId, request.providerOptions);
        const body = {
            model: request.modelId || this.defaultModelId,
            messages: [{ role: 'user', content: request.prompt }],
            modalities: request.modalities && request.modalities.length > 0 ? request.modalities : ['image', 'text'],
            stream: false,
        };
        const imageConfig = {};
        if (request.aspectRatio)
            imageConfig.aspect_ratio = request.aspectRatio;
        if (request.size)
            imageConfig.image_size = request.size;
        if (request.outputFormat)
            imageConfig.image_format = normalizeOutputFormat(request.outputFormat);
        if (providerOptions?.imageConfig)
            Object.assign(imageConfig, providerOptions.imageConfig);
        if (Object.keys(imageConfig).length > 0)
            body.image_config = imageConfig;
        if (providerOptions) {
            const { imageConfig: _imageConfig, provider, transforms, extraBody, ...passthrough } = providerOptions;
            if (provider)
                body.provider = provider;
            if (transforms)
                body.transforms = transforms;
            if (Object.keys(passthrough).length > 0)
                Object.assign(body, passthrough);
            if (extraBody)
                Object.assign(body, extraBody);
        }
        const headers = {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
        };
        if (this.config.siteUrl)
            headers['HTTP-Referer'] = this.config.siteUrl;
        if (this.config.appName)
            headers['X-Title'] = this.config.appName;
        const response = await fetch(`${this.config.baseURL}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter image generation failed (${response.status}): ${errorText}`);
        }
        const json = (await response.json());
        const message = json.choices?.[0]?.message;
        const images = (message?.images ?? [])
            .map((item) => item.image_url?.url ?? item.imageUrl?.url)
            .filter((value) => typeof value === 'string' && value.length > 0)
            .map((value) => {
            const parsed = parseDataUrl(value);
            return {
                ...parsed,
                url: parsed.dataUrl?.startsWith('data:') ? undefined : parsed.dataUrl,
            };
        });
        return {
            created: json.created ?? Math.floor(Date.now() / 1000),
            modelId: json.model ?? String(body.model),
            providerId: this.providerId,
            text: typeof message?.content === 'string' ? message.content : undefined,
            images,
            usage: {
                totalImages: images.length,
                promptTokens: json.usage?.prompt_tokens,
                completionTokens: json.usage?.completion_tokens,
                totalTokens: json.usage?.total_tokens,
                totalCostUSD: json.usage?.cost,
            },
        };
    }
    async listAvailableModels() {
        return [];
    }
}
//# sourceMappingURL=OpenRouterImageProvider.js.map