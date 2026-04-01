const BUILT_IN_IMAGE_PROVIDER_IDS = new Set(['openai', 'openrouter', 'stability', 'replicate', 'stable-diffusion-local']);
export function getImageProviderOptions(providerId, providerOptions) {
    if (!providerOptions || typeof providerOptions !== 'object' || Array.isArray(providerOptions)) {
        return undefined;
    }
    const bag = providerOptions;
    const directMatch = bag[providerId];
    if (directMatch && typeof directMatch === 'object' && !Array.isArray(directMatch)) {
        return directMatch;
    }
    const hasNamespacedProviderKeys = Object.keys(providerOptions).some((key) => BUILT_IN_IMAGE_PROVIDER_IDS.has(key) || key === providerId);
    if (hasNamespacedProviderKeys) {
        return undefined;
    }
    return providerOptions;
}
export function parseDataUrl(value) {
    const match = /^data:([^;,]+)?;base64,(.+)$/i.exec(value.trim());
    if (!match) {
        return { dataUrl: value };
    }
    return {
        mimeType: match[1] || undefined,
        base64: match[2],
        dataUrl: value,
    };
}
export function normalizeOutputFormat(format) {
    if (!format) {
        return undefined;
    }
    return format === 'jpg' ? 'jpeg' : format;
}
export function parseImageSize(size) {
    if (!size) {
        return {};
    }
    const match = /^(\d+)x(\d+)$/i.exec(size.trim());
    if (!match) {
        return {};
    }
    return {
        width: Number.parseInt(match[1], 10),
        height: Number.parseInt(match[2], 10),
    };
}
export function inferAspectRatioFromSize(size) {
    if (!size) {
        return undefined;
    }
    switch (size.trim()) {
        case '1024x1024':
        case '512x512':
        case '256x256':
            return '1:1';
        case '1792x1024':
            return '16:9';
        case '1024x1792':
            return '9:16';
        default:
            break;
    }
    const { width, height } = parseImageSize(size);
    if (!width || !height) {
        return undefined;
    }
    const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(width, height);
    return `${width / divisor}:${height / divisor}`;
}
//# sourceMappingURL=IImageProvider.js.map