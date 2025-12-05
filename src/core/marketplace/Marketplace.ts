/**
 * @file Marketplace.ts
 * @description In-memory implementation of the Agent Marketplace.
 * Provides publishing, discovery, and installation of agents, personas, and extensions.
 *
 * @module AgentOS/Marketplace
 * @version 1.0.0
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  IMarketplace,
  MarketplaceItem,
  MarketplaceItemType,
  MarketplaceSearchOptions,
  MarketplaceSearchResult,
  InstalledItem,
  InstallationResult,
  InstallationStatus,
  Review,
  MarketplaceStats,
  PublisherInfo,
  ItemStats,
  RatingSummary,
  PricingInfo,
} from './IMarketplace';
import type { ILogger } from '../../logging/ILogger';

/**
 * Configuration for Marketplace
 */
export interface MarketplaceConfig {
  /** Logger instance */
  logger?: ILogger;
  /** Current user ID (for installations/reviews) */
  userId?: string;
}

/**
 * Default empty stats
 */
const DEFAULT_STATS: ItemStats = {
  downloads: 0,
  weeklyDownloads: 0,
  activeInstalls: 0,
  views: 0,
};

/**
 * Default empty ratings
 */
const DEFAULT_RATINGS: RatingSummary = {
  average: 0,
  count: 0,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
};

/**
 * In-memory Marketplace implementation
 */
export class Marketplace implements IMarketplace {
  private readonly items = new Map<string, MarketplaceItem>();
  private readonly installations = new Map<string, InstalledItem>();
  private readonly reviews = new Map<string, Review>();
  private readonly reviewsByItem = new Map<string, Set<string>>();
  private readonly viewCounts = new Map<string, number>();

  private readonly logger?: ILogger;
  private userId: string;

  constructor(config: MarketplaceConfig = {}) {
    this.logger = config.logger;
    this.userId = config.userId || 'anonymous';
  }

  async initialize(): Promise<void> {
    this.logger?.info?.('Marketplace initialized');
    // Seed with some sample items for testing
    await this.seedSampleItems();
  }

  // ============================================================================
  // Search & Discovery
  // ============================================================================

  async search(options?: MarketplaceSearchOptions): Promise<MarketplaceSearchResult> {
    const startTime = Date.now();
    let results = Array.from(this.items.values()).filter(item => item.status === 'published');

    // Text search
    if (options?.query) {
      const query = options.query.toLowerCase();
      results = results.filter(item =>
        item.name.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.tags.some(t => t.toLowerCase().includes(query))
      );
    }

    // Type filter
    if (options?.types?.length) {
      const typeSet = new Set(options.types);
      results = results.filter(item => typeSet.has(item.type));
    }

    // Category filter
    if (options?.categories?.length) {
      const catSet = new Set(options.categories);
      results = results.filter(item => item.categories.some(c => catSet.has(c)));
    }

    // Tag filter
    if (options?.tags?.length) {
      const tagSet = new Set(options.tags);
      results = results.filter(item => item.tags.some(t => tagSet.has(t)));
    }

    // Publisher filter
    if (options?.publisherId) {
      results = results.filter(item => item.publisher.id === options.publisherId);
    }

    // Pricing model filter
    if (options?.pricingModel?.length) {
      const modelSet = new Set(options.pricingModel);
      results = results.filter(item => modelSet.has(item.pricing.model));
    }

    // Rating filter
    if (options?.minRating !== undefined) {
      results = results.filter(item => item.ratings.average >= options.minRating!);
    }

    // License filter
    if (options?.licenses?.length) {
      const licSet = new Set(options.licenses);
      results = results.filter(item => licSet.has(item.license));
    }

    // Exclude deprecated
    if (!options?.includeDeprecated) {
      results = results.filter(item => item.status !== 'deprecated');
    }

    // Sort
    const sortBy = options?.sortBy || 'relevance';
    const sortDir = options?.sortDirection || 'desc';
    const mult = sortDir === 'desc' ? -1 : 1;

    results.sort((a, b) => {
      switch (sortBy) {
        case 'downloads':
          return mult * (a.stats.downloads - b.stats.downloads);
        case 'rating':
          return mult * (a.ratings.average - b.ratings.average);
        case 'newest':
          return mult * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        case 'updated':
          return mult * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
        case 'name':
          return mult * a.name.localeCompare(b.name);
        default: // relevance - downloads weighted
          return mult * (a.stats.downloads * 0.5 + a.ratings.average * 100 - b.stats.downloads * 0.5 - b.ratings.average * 100);
      }
    });

    // Build facets
    const allItems = Array.from(this.items.values()).filter(i => i.status === 'published');
    const facets = this.buildFacets(allItems);

    // Paginate
    const total = results.length;
    const offset = options?.offset || 0;
    const limit = options?.limit || 20;
    const paginatedResults = results.slice(offset, offset + limit);

    return {
      items: paginatedResults,
      total,
      facets,
      searchMeta: {
        query: options?.query,
        took: Date.now() - startTime,
        offset,
        limit,
      },
    };
  }

  async getItem(itemId: string): Promise<MarketplaceItem | undefined> {
    return this.items.get(itemId);
  }

  async getItems(itemIds: string[]): Promise<MarketplaceItem[]> {
    return itemIds.map(id => this.items.get(id)).filter((item): item is MarketplaceItem => !!item);
  }

  async getFeatured(type?: MarketplaceItemType, limit = 10): Promise<MarketplaceItem[]> {
    let items = Array.from(this.items.values()).filter(i => i.status === 'published');
    if (type) items = items.filter(i => i.type === type);

    // Featured = high downloads + high ratings + verified publisher
    return items
      .filter(i => i.publisher.verified || i.ratings.average >= 4)
      .sort((a, b) => (b.stats.downloads * b.ratings.average) - (a.stats.downloads * a.ratings.average))
      .slice(0, limit);
  }

  async getTrending(type?: MarketplaceItemType, period: 'day' | 'week' | 'month' = 'week', limit = 10): Promise<MarketplaceItem[]> {
    let items = Array.from(this.items.values()).filter(i => i.status === 'published');
    if (type) items = items.filter(i => i.type === type);

    // Trending = high recent downloads
    return items
      .sort((a, b) => b.stats.weeklyDownloads - a.stats.weeklyDownloads)
      .slice(0, limit);
  }

  async getRecent(type?: MarketplaceItemType, limit = 10): Promise<MarketplaceItem[]> {
    let items = Array.from(this.items.values()).filter(i => i.status === 'published');
    if (type) items = items.filter(i => i.type === type);

    return items
      .sort((a, b) => new Date(b.publishedAt || b.createdAt).getTime() - new Date(a.publishedAt || a.createdAt).getTime())
      .slice(0, limit);
  }

  async getByPublisher(publisherId: string, options?: MarketplaceSearchOptions): Promise<MarketplaceSearchResult> {
    return this.search({ ...options, publisherId });
  }

  // ============================================================================
  // Item Details
  // ============================================================================

  async getReviews(itemId: string, options?: { sortBy?: 'newest' | 'helpful' | 'rating'; limit?: number; offset?: number }): Promise<{ reviews: Review[]; total: number }> {
    const reviewIds = this.reviewsByItem.get(itemId) || new Set();
    let reviews = Array.from(reviewIds).map(id => this.reviews.get(id)).filter((r): r is Review => !!r);

    const sortBy = options?.sortBy || 'newest';
    reviews.sort((a, b) => {
      switch (sortBy) {
        case 'helpful':
          return b.helpfulVotes - a.helpfulVotes;
        case 'rating':
          return b.rating - a.rating;
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });

    const total = reviews.length;
    const offset = options?.offset || 0;
    const limit = options?.limit || 10;

    return {
      reviews: reviews.slice(offset, offset + limit),
      total,
    };
  }

  async getVersions(itemId: string): Promise<Array<{ version: string; releasedAt: string; changelog?: string }>> {
    const item = this.items.get(itemId);
    if (!item) return [];

    // In a real implementation, versions would be tracked separately
    return [
      { version: item.version, releasedAt: item.updatedAt, changelog: 'Current version' },
    ];
  }

  async getDependencyTree(itemId: string): Promise<{ item: MarketplaceItem; dependencies: MarketplaceItem[] }> {
    const item = this.items.get(itemId);
    if (!item) throw new Error(`Item not found: ${itemId}`);

    const dependencies: MarketplaceItem[] = [];
    if (item.dependencies) {
      for (const dep of item.dependencies) {
        const depItem = this.items.get(dep.itemId);
        if (depItem) dependencies.push(depItem);
      }
    }

    return { item, dependencies };
  }

  // ============================================================================
  // Installation
  // ============================================================================

  async install(itemId: string, options?: { version?: string; config?: Record<string, unknown>; autoUpdate?: boolean }): Promise<InstallationResult> {
    const item = this.items.get(itemId);
    if (!item) {
      return { success: false, error: 'Item not found' };
    }

    // Check if already installed
    const existing = Array.from(this.installations.values()).find(i => i.itemId === itemId);
    if (existing) {
      return { success: false, error: 'Item already installed' };
    }

    const installation: InstalledItem = {
      installationId: `inst-${uuidv4()}`,
      itemId,
      version: options?.version || item.version,
      status: 'installed',
      config: options?.config || item.defaultConfig,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      autoUpdate: options?.autoUpdate ?? true,
    };

    this.installations.set(installation.installationId, installation);

    // Update stats
    item.stats.downloads++;
    item.stats.weeklyDownloads++;
    item.stats.activeInstalls++;

    this.logger?.info?.('Item installed', { itemId, installationId: installation.installationId });

    return { success: true, installation };
  }

  async update(installationId: string, options?: { version?: string; config?: Record<string, unknown> }): Promise<InstallationResult> {
    const installation = this.installations.get(installationId);
    if (!installation) {
      return { success: false, error: 'Installation not found' };
    }

    const item = this.items.get(installation.itemId);
    if (!item) {
      return { success: false, error: 'Item not found' };
    }

    installation.version = options?.version || item.version;
    if (options?.config) {
      installation.config = { ...installation.config, ...options.config };
    }
    installation.updatedAt = new Date().toISOString();

    this.logger?.info?.('Installation updated', { installationId });

    return { success: true, installation };
  }

  async uninstall(installationId: string): Promise<{ success: boolean; error?: string }> {
    const installation = this.installations.get(installationId);
    if (!installation) {
      return { success: false, error: 'Installation not found' };
    }

    const item = this.items.get(installation.itemId);
    if (item) {
      item.stats.activeInstalls = Math.max(0, item.stats.activeInstalls - 1);
    }

    this.installations.delete(installationId);
    this.logger?.info?.('Item uninstalled', { installationId });

    return { success: true };
  }

  async getInstalled(options?: { type?: MarketplaceItemType; status?: InstallationStatus }): Promise<InstalledItem[]> {
    let results = Array.from(this.installations.values());

    if (options?.status) {
      results = results.filter(i => i.status === options.status);
    }

    if (options?.type) {
      results = results.filter(i => {
        const item = this.items.get(i.itemId);
        return item?.type === options.type;
      });
    }

    return results;
  }

  async getInstallation(installationId: string): Promise<InstalledItem | undefined> {
    return this.installations.get(installationId);
  }

  async checkUpdates(): Promise<Array<{ installation: InstalledItem; latestVersion: string; currentVersion: string }>> {
    const updates: Array<{ installation: InstalledItem; latestVersion: string; currentVersion: string }> = [];

    for (const installation of this.installations.values()) {
      const item = this.items.get(installation.itemId);
      if (item && item.version !== installation.version) {
        updates.push({
          installation,
          latestVersion: item.version,
          currentVersion: installation.version,
        });
      }
    }

    return updates;
  }

  // ============================================================================
  // Publishing
  // ============================================================================

  async publish(itemInput: Omit<MarketplaceItem, 'id' | 'stats' | 'ratings' | 'createdAt' | 'updatedAt' | 'publishedAt'>): Promise<MarketplaceItem> {
    const now = new Date().toISOString();

    const item: MarketplaceItem = {
      ...itemInput,
      id: `item-${uuidv4()}`,
      stats: { ...DEFAULT_STATS },
      ratings: { ...DEFAULT_RATINGS },
      createdAt: now,
      updatedAt: now,
      publishedAt: itemInput.status === 'published' ? now : undefined,
    };

    this.items.set(item.id, item);
    this.logger?.info?.('Item published', { itemId: item.id, name: item.name });

    return item;
  }

  async updateItem(itemId: string, updates: Partial<MarketplaceItem>): Promise<MarketplaceItem> {
    const item = this.items.get(itemId);
    if (!item) throw new Error(`Item not found: ${itemId}`);

    Object.assign(item, updates, { updatedAt: new Date().toISOString() });

    if (updates.status === 'published' && !item.publishedAt) {
      item.publishedAt = new Date().toISOString();
    }

    this.logger?.info?.('Item updated', { itemId });
    return item;
  }

  async publishVersion(itemId: string, version: string, options?: { changelog?: string; breaking?: boolean }): Promise<void> {
    const item = this.items.get(itemId);
    if (!item) throw new Error(`Item not found: ${itemId}`);

    item.version = version;
    item.updatedAt = new Date().toISOString();

    this.logger?.info?.('Version published', { itemId, version });
  }

  async deprecate(itemId: string, reason: string, alternativeId?: string): Promise<void> {
    const item = this.items.get(itemId);
    if (!item) throw new Error(`Item not found: ${itemId}`);

    item.status = 'deprecated';
    item.metadata = { ...item.metadata, deprecationReason: reason, alternativeId };
    item.updatedAt = new Date().toISOString();

    this.logger?.info?.('Item deprecated', { itemId, reason });
  }

  // ============================================================================
  // Reviews & Ratings
  // ============================================================================

  async submitReview(itemId: string, review: { rating: number; title?: string; body: string }): Promise<Review> {
    const item = this.items.get(itemId);
    if (!item) throw new Error(`Item not found: ${itemId}`);

    const reviewRecord: Review = {
      id: `review-${uuidv4()}`,
      itemId,
      reviewer: {
        id: this.userId,
        name: `User ${this.userId}`,
      },
      rating: Math.min(5, Math.max(1, review.rating)),
      title: review.title,
      body: review.body,
      version: item.version,
      helpfulVotes: 0,
      createdAt: new Date().toISOString(),
    };

    this.reviews.set(reviewRecord.id, reviewRecord);

    if (!this.reviewsByItem.has(itemId)) {
      this.reviewsByItem.set(itemId, new Set());
    }
    this.reviewsByItem.get(itemId)!.add(reviewRecord.id);

    // Update item ratings
    this.recalculateRatings(itemId);

    this.logger?.info?.('Review submitted', { reviewId: reviewRecord.id, itemId });
    return reviewRecord;
  }

  async updateReview(reviewId: string, updates: { rating?: number; title?: string; body?: string }): Promise<Review> {
    const review = this.reviews.get(reviewId);
    if (!review) throw new Error(`Review not found: ${reviewId}`);

    if (updates.rating) review.rating = Math.min(5, Math.max(1, updates.rating));
    if (updates.title !== undefined) review.title = updates.title;
    if (updates.body !== undefined) review.body = updates.body;

    this.recalculateRatings(review.itemId);

    return review;
  }

  async deleteReview(reviewId: string): Promise<void> {
    const review = this.reviews.get(reviewId);
    if (!review) return;

    this.reviews.delete(reviewId);
    this.reviewsByItem.get(review.itemId)?.delete(reviewId);
    this.recalculateRatings(review.itemId);
  }

  async markReviewHelpful(reviewId: string): Promise<void> {
    const review = this.reviews.get(reviewId);
    if (review) {
      review.helpfulVotes++;
    }
  }

  async respondToReview(reviewId: string, response: string): Promise<void> {
    const review = this.reviews.get(reviewId);
    if (!review) throw new Error(`Review not found: ${reviewId}`);

    review.publisherResponse = {
      body: response,
      respondedAt: new Date().toISOString(),
    };
  }

  // ============================================================================
  // Analytics
  // ============================================================================

  async getStats(): Promise<MarketplaceStats> {
    const items = Array.from(this.items.values()).filter(i => i.status === 'published');
    const publishers = new Set(items.map(i => i.publisher.id));

    const itemsByType: Record<MarketplaceItemType, number> = {
      agent: 0, persona: 0, workflow: 0, extension: 0, template: 0,
    };
    items.forEach(i => itemsByType[i.type]++);

    const categoryCount = new Map<string, number>();
    items.forEach(i => i.categories.forEach(c => categoryCount.set(c, (categoryCount.get(c) || 0) + 1)));

    const topCategories = Array.from(categoryCount.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const totalDownloads = items.reduce((sum, i) => sum + i.stats.downloads, 0);
    const avgRating = items.length > 0
      ? items.reduce((sum, i) => sum + i.ratings.average, 0) / items.length
      : 0;

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentlyAdded = items.filter(i => new Date(i.createdAt).getTime() > oneWeekAgo).length;

    return {
      totalItems: items.length,
      totalPublishers: publishers.size,
      totalDownloads,
      itemsByType,
      topCategories,
      recentlyAdded,
      averageRating: avgRating,
    };
  }

  async recordView(itemId: string): Promise<void> {
    const item = this.items.get(itemId);
    if (item) {
      item.stats.views++;
      this.viewCounts.set(itemId, (this.viewCounts.get(itemId) || 0) + 1);
    }
  }

  async getItemAnalytics(itemId: string, period?: 'day' | 'week' | 'month' | 'year'): Promise<{
    views: Array<{ date: string; count: number }>;
    downloads: Array<{ date: string; count: number }>;
    activeInstalls: number;
    uninstalls: number;
    ratings: Array<{ date: string; rating: number }>;
  }> {
    const item = this.items.get(itemId);
    if (!item) throw new Error(`Item not found: ${itemId}`);

    // In a real implementation, this would query time-series data
    const today = new Date().toISOString().split('T')[0];

    return {
      views: [{ date: today, count: item.stats.views }],
      downloads: [{ date: today, count: item.stats.downloads }],
      activeInstalls: item.stats.activeInstalls,
      uninstalls: 0,
      ratings: [{ date: today, rating: item.ratings.average }],
    };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private buildFacets(items: MarketplaceItem[]) {
    const categories = new Map<string, number>();
    const tags = new Map<string, number>();
    const types = new Map<MarketplaceItemType, number>();
    const pricingModels = new Map<string, number>();

    items.forEach(item => {
      item.categories.forEach(c => categories.set(c, (categories.get(c) || 0) + 1));
      item.tags.forEach(t => tags.set(t, (tags.get(t) || 0) + 1));
      types.set(item.type, (types.get(item.type) || 0) + 1);
      pricingModels.set(item.pricing.model, (pricingModels.get(item.pricing.model) || 0) + 1);
    });

    return {
      categories: Array.from(categories.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      tags: Array.from(tags.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 20),
      types: Array.from(types.entries()).map(([type, count]) => ({ type, count })),
      pricingModels: Array.from(pricingModels.entries()).map(([model, count]) => ({ model, count })),
    };
  }

  private recalculateRatings(itemId: string): void {
    const item = this.items.get(itemId);
    if (!item) return;

    const reviewIds = this.reviewsByItem.get(itemId) || new Set();
    const reviews = Array.from(reviewIds).map(id => this.reviews.get(id)).filter((r): r is Review => !!r);

    if (reviews.length === 0) {
      item.ratings = { ...DEFAULT_RATINGS };
      return;
    }

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;

    reviews.forEach(r => {
      distribution[r.rating as keyof typeof distribution]++;
      sum += r.rating;
    });

    item.ratings = {
      average: sum / reviews.length,
      count: reviews.length,
      distribution,
    };
  }

  private async seedSampleItems(): Promise<void> {
    const samplePublisher: PublisherInfo = {
      id: 'pub-framers',
      name: 'Frame.dev',
      type: 'organization',
      verified: true,
      websiteUrl: 'https://frame.dev',
    };

    const samplePricing: PricingInfo = { model: 'free' };

    const sampleItems: Array<Omit<MarketplaceItem, 'id' | 'stats' | 'ratings' | 'createdAt' | 'updatedAt' | 'publishedAt'>> = [
      {
        type: 'agent',
        name: 'Research Assistant',
        description: 'An AI agent specialized in web research, fact-checking, and summarization.',
        version: '1.2.0',
        publisher: samplePublisher,
        visibility: 'public',
        status: 'published',
        categories: ['productivity', 'research'],
        tags: ['research', 'summarization', 'web-search'],
        license: 'MIT',
        pricing: samplePricing,
        agentosVersion: '^2.0.0',
      },
      {
        type: 'persona',
        name: 'Code Reviewer',
        description: 'A persona for detailed, constructive code reviews with best practices.',
        version: '1.0.0',
        publisher: samplePublisher,
        visibility: 'public',
        status: 'published',
        categories: ['development', 'code-quality'],
        tags: ['code-review', 'development', 'best-practices'],
        license: 'MIT',
        pricing: samplePricing,
        agentosVersion: '^2.0.0',
      },
      {
        type: 'workflow',
        name: 'Document Analysis Pipeline',
        description: 'Automated workflow for analyzing, summarizing, and extracting insights from documents.',
        version: '2.0.0',
        publisher: samplePublisher,
        visibility: 'public',
        status: 'published',
        categories: ['automation', 'documents'],
        tags: ['document', 'analysis', 'extraction'],
        license: 'Apache-2.0',
        pricing: samplePricing,
        agentosVersion: '^2.0.0',
      },
      {
        type: 'extension',
        name: 'Slack Integration',
        description: 'Connect your agents to Slack for notifications and commands.',
        version: '1.1.0',
        publisher: samplePublisher,
        visibility: 'public',
        status: 'published',
        categories: ['integrations', 'communication'],
        tags: ['slack', 'notifications', 'integration'],
        license: 'MIT',
        pricing: samplePricing,
        agentosVersion: '^2.0.0',
      },
    ];

    for (const item of sampleItems) {
      await this.publish(item);
    }
  }
}


