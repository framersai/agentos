/**
 * @file Marketplace.ts
 * @description In-memory implementation of the Agent Marketplace.
 * Provides publishing, discovery, and installation of agents, personas, and extensions.
 *
 * @module AgentOS/Marketplace
 * @version 1.0.0
 */
import type { IMarketplace, MarketplaceItem, MarketplaceItemType, MarketplaceSearchOptions, MarketplaceSearchResult, InstalledItem, InstallationResult, InstallationStatus, Review, MarketplaceStats } from './IMarketplace';
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
 * In-memory Marketplace implementation
 */
export declare class Marketplace implements IMarketplace {
    private readonly items;
    private readonly installations;
    private readonly reviews;
    private readonly reviewsByItem;
    private readonly viewCounts;
    private readonly logger?;
    private userId;
    constructor(config?: MarketplaceConfig);
    initialize(): Promise<void>;
    search(options?: MarketplaceSearchOptions): Promise<MarketplaceSearchResult>;
    getItem(itemId: string): Promise<MarketplaceItem | undefined>;
    getItems(itemIds: string[]): Promise<MarketplaceItem[]>;
    getFeatured(type?: MarketplaceItemType, limit?: number): Promise<MarketplaceItem[]>;
    getTrending(type?: MarketplaceItemType, _period?: 'day' | 'week' | 'month', limit?: number): Promise<MarketplaceItem[]>;
    getRecent(type?: MarketplaceItemType, limit?: number): Promise<MarketplaceItem[]>;
    getByPublisher(publisherId: string, options?: MarketplaceSearchOptions): Promise<MarketplaceSearchResult>;
    getReviews(itemId: string, options?: {
        sortBy?: 'newest' | 'helpful' | 'rating';
        limit?: number;
        offset?: number;
    }): Promise<{
        reviews: Review[];
        total: number;
    }>;
    getVersions(itemId: string): Promise<Array<{
        version: string;
        releasedAt: string;
        changelog?: string;
    }>>;
    getDependencyTree(itemId: string): Promise<{
        item: MarketplaceItem;
        dependencies: MarketplaceItem[];
    }>;
    install(itemId: string, options?: {
        version?: string;
        config?: Record<string, unknown>;
        autoUpdate?: boolean;
    }): Promise<InstallationResult>;
    update(installationId: string, options?: {
        version?: string;
        config?: Record<string, unknown>;
    }): Promise<InstallationResult>;
    uninstall(installationId: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    getInstalled(options?: {
        type?: MarketplaceItemType;
        status?: InstallationStatus;
    }): Promise<InstalledItem[]>;
    getInstallation(installationId: string): Promise<InstalledItem | undefined>;
    checkUpdates(): Promise<Array<{
        installation: InstalledItem;
        latestVersion: string;
        currentVersion: string;
    }>>;
    publish(itemInput: Omit<MarketplaceItem, 'id' | 'stats' | 'ratings' | 'createdAt' | 'updatedAt' | 'publishedAt'>): Promise<MarketplaceItem>;
    updateItem(itemId: string, updates: Partial<MarketplaceItem>): Promise<MarketplaceItem>;
    publishVersion(itemId: string, version: string, _options?: {
        changelog?: string;
        breaking?: boolean;
    }): Promise<void>;
    deprecate(itemId: string, reason: string, alternativeId?: string): Promise<void>;
    submitReview(itemId: string, review: {
        rating: number;
        title?: string;
        body: string;
    }): Promise<Review>;
    updateReview(reviewId: string, updates: {
        rating?: number;
        title?: string;
        body?: string;
    }): Promise<Review>;
    deleteReview(reviewId: string): Promise<void>;
    markReviewHelpful(reviewId: string): Promise<void>;
    respondToReview(reviewId: string, response: string): Promise<void>;
    getStats(): Promise<MarketplaceStats>;
    recordView(itemId: string): Promise<void>;
    getItemAnalytics(itemId: string, _period?: 'day' | 'week' | 'month' | 'year'): Promise<{
        views: Array<{
            date: string;
            count: number;
        }>;
        downloads: Array<{
            date: string;
            count: number;
        }>;
        activeInstalls: number;
        uninstalls: number;
        ratings: Array<{
            date: string;
            rating: number;
        }>;
    }>;
    private buildFacets;
    private recalculateRatings;
    private seedSampleItems;
}
//# sourceMappingURL=Marketplace.d.ts.map