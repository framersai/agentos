export class TavilyProvider {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.providerId = 'tavily';
        this.weight = 1.0;
    }
    isAvailable() {
        return this.apiKey.length > 0;
    }
    async search(query, limit = 5) {
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: this.apiKey,
                query,
                search_depth: 'advanced',
                include_answer: false,
                include_raw_content: false,
                max_results: limit,
            }),
        });
        const data = await res.json();
        return (data.results ?? []).map((r) => ({
            url: String(r.url ?? ''),
            title: String(r.title ?? ''),
            snippet: String(r.content ?? ''),
            relevanceScore: typeof r.score === 'number' ? r.score : 0.5,
        }));
    }
}
//# sourceMappingURL=TavilyProvider.js.map