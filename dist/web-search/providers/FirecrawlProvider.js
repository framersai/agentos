export class FirecrawlProvider {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.providerId = 'firecrawl';
        this.weight = 1.5;
    }
    isAvailable() {
        return this.apiKey.length > 0;
    }
    async search(query, limit = 5) {
        const res = await fetch('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query,
                limit,
                scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
            }),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`Firecrawl search failed (${res.status}): ${errText}`);
        }
        const data = await res.json();
        if (!data.success || !Array.isArray(data.data))
            return [];
        return data.data.map((r) => ({
            url: String(r.url ?? r.metadata?.sourceURL ?? ''),
            title: String(r.title ?? r.metadata?.title ?? ''),
            snippet: String(r.description ?? r.metadata?.description ?? ''),
            content: typeof r.markdown === 'string' ? r.markdown : undefined,
        }));
    }
}
//# sourceMappingURL=FirecrawlProvider.js.map