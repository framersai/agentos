import { ApiKeyPool } from '../../core/providers/ApiKeyPool.js';
export class BraveProvider {
    constructor(apiKey) {
        this.providerId = 'brave';
        this.weight = 1.0;
        this.keyPool = new ApiKeyPool(apiKey);
    }
    isAvailable() {
        return this.keyPool.hasKeys;
    }
    async search(query, limit = 5) {
        const params = new URLSearchParams({ q: query, count: String(limit) });
        const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
            headers: { 'X-Subscription-Token': this.keyPool.next() },
        });
        const data = await res.json();
        return (data.web?.results ?? []).map((r) => ({
            url: String(r.url ?? ''),
            title: String(r.title ?? ''),
            snippet: String(r.description ?? ''),
        }));
    }
}
//# sourceMappingURL=BraveProvider.js.map