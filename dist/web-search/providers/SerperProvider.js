export class SerperProvider {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.providerId = 'serper';
        this.weight = 1.0;
    }
    isAvailable() {
        return this.apiKey.length > 0;
    }
    async search(query, limit = 5) {
        const res = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
                'X-API-KEY': this.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ q: query, num: limit }),
        });
        const data = await res.json();
        return (data.organic ?? []).map((r) => ({
            url: String(r.link ?? ''),
            title: String(r.title ?? ''),
            snippet: String(r.snippet ?? ''),
        }));
    }
}
//# sourceMappingURL=SerperProvider.js.map