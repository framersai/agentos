/**
 * @file IMarketplace.ts
 * @description Agent Marketplace interface for publishing, discovering,
 * and installing agents, personas, workflows, and extensions.
 *
 * @module AgentOS/Marketplace
 * @version 1.0.0
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Types of items available in the marketplace
 */
export type MarketplaceItemType = 'agent' | 'persona' | 'workflow' | 'extension' | 'template';

/**
 * Visibility level of marketplace items
 */
export type ItemVisibility = 'public' | 'unlisted' | 'private' | 'organization';

/**
 * Item status in the marketplace
 */
export type ItemStatus = 'draft' | 'pending_review' | 'published' | 'suspended' | 'deprecated';

/**
 * Represents a marketplace item (agent, persona, workflow, etc.)
 */
export interface MarketplaceItem {
  /** Unique item ID */
  id: string;
  /** Item type */
  type: MarketplaceItemType;
  /** Human-readable name */
  name: string;
  /** Short description */
  description: string;
  /** Detailed README/documentation (markdown) */
  readme?: string;
  /** Version string (semver) */
  version: string;
  /** Publisher/author info */
  publisher: PublisherInfo;
  /** Visibility level */
  visibility: ItemVisibility;
  /** Current status */
  status: ItemStatus;
  /** Category tags */
  categories: string[];
  /** Search tags */
  tags: string[];
  /** Icon URL */
  iconUrl?: string;
  /** Banner image URL */
  bannerUrl?: string;
  /** Screenshots/preview images */
  screenshots?: string[];
  /** License identifier (e.g., MIT, Apache-2.0) */
  license: string;
  /** Repository URL */
  repositoryUrl?: string;
  /** Homepage URL */
  homepageUrl?: string;
  /** Pricing info */
  pricing: PricingInfo;
  /** Statistics */
  stats: ItemStats;
  /** Ratings and reviews summary */
  ratings: RatingSummary;
  /** Dependencies on other items */
  dependencies?: ItemDependency[];
  /** Required AgentOS version */
  agentosVersion: string;
  /** Item configuration schema */
  configSchema?: Record<string, unknown>;
  /** Default configuration */
  defaultConfig?: Record<string, unknown>;
  /** When the item was created */
  createdAt: string;
  /** When the item was last updated */
  updatedAt: string;
  /** When the item was published */
  publishedAt?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Publisher/author information
 */
export interface PublisherInfo {
  /** Publisher ID */
  id: string;
  /** Display name */
  name: string;
  /** Publisher type */
  type: 'individual' | 'organization' | 'verified';
  /** Avatar URL */
  avatarUrl?: string;
  /** Verification status */
  verified: boolean;
  /** Publisher website */
  websiteUrl?: string;
  /** Support email */
  supportEmail?: string;
}

/**
 * Pricing information
 */
export interface PricingInfo {
  /** Pricing model */
  model: 'free' | 'one_time' | 'subscription' | 'usage_based' | 'freemium';
  /** Price in cents (for one_time or subscription) */
  priceInCents?: number;
  /** Currency code */
  currency?: string;
  /** Billing period for subscriptions */
  billingPeriod?: 'monthly' | 'yearly';
  /** Usage pricing tiers */
  usageTiers?: Array<{
    upTo: number;
    pricePerUnit: number;
    unit: string;
  }>;
  /** Free tier limits */
  freeTierLimits?: Record<string, number>;
}

/**
 * Item statistics
 */
export interface ItemStats {
  /** Total downloads/installations */
  downloads: number;
  /** Weekly downloads */
  weeklyDownloads: number;
  /** Active installations */
  activeInstalls: number;
  /** Total views */
  views: number;
  /** GitHub stars (if linked) */
  githubStars?: number;
  /** Number of forks */
  forks?: number;
}

/**
 * Rating summary
 */
export interface RatingSummary {
  /** Average rating (1-5) */
  average: number;
  /** Total number of ratings */
  count: number;
  /** Distribution by star count */
  distribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
}

/**
 * Item dependency
 */
export interface ItemDependency {
  /** Dependency item ID */
  itemId: string;
  /** Required version range */
  versionRange: string;
  /** Is this a required or optional dependency? */
  optional: boolean;
}

/**
 * User review
 */
export interface Review {
  /** Review ID */
  id: string;
  /** Item ID being reviewed */
  itemId: string;
  /** Reviewer info */
  reviewer: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  /** Rating (1-5) */
  rating: number;
  /** Review title */
  title?: string;
  /** Review text */
  body: string;
  /** Version reviewed */
  version: string;
  /** Helpful votes */
  helpfulVotes: number;
  /** When the review was posted */
  createdAt: string;
  /** Publisher's response */
  publisherResponse?: {
    body: string;
    respondedAt: string;
  };
}

// ============================================================================
// Search & Query Types
// ============================================================================

/**
 * Search options for marketplace items
 */
export interface MarketplaceSearchOptions {
  /** Search query text */
  query?: string;
  /** Filter by item types */
  types?: MarketplaceItemType[];
  /** Filter by categories */
  categories?: string[];
  /** Filter by tags */
  tags?: string[];
  /** Filter by publisher */
  publisherId?: string;
  /** Filter by pricing model */
  pricingModel?: PricingInfo['model'][];
  /** Minimum rating */
  minRating?: number;
  /** Filter by license */
  licenses?: string[];
  /** Sort by */
  sortBy?: 'relevance' | 'downloads' | 'rating' | 'newest' | 'updated' | 'name';
  /** Sort direction */
  sortDirection?: 'asc' | 'desc';
  /** Pagination offset */
  offset?: number;
  /** Results per page */
  limit?: number;
  /** Include deprecated items */
  includeDeprecated?: boolean;
}

/**
 * Search results
 */
export interface MarketplaceSearchResult {
  /** Matching items */
  items: MarketplaceItem[];
  /** Total count of matches */
  total: number;
  /** Facets for filtering */
  facets: {
    categories: Array<{ name: string; count: number }>;
    tags: Array<{ name: string; count: number }>;
    types: Array<{ type: MarketplaceItemType; count: number }>;
    pricingModels: Array<{ model: string; count: number }>;
  };
  /** Search metadata */
  searchMeta: {
    query?: string;
    took: number;
    offset: number;
    limit: number;
  };
}

// ============================================================================
// Installation Types
// ============================================================================

/**
 * Installation status
 */
export type InstallationStatus = 'pending' | 'installing' | 'installed' | 'failed' | 'updating' | 'uninstalling';

/**
 * Installed item record
 */
export interface InstalledItem {
  /** Installation ID */
  installationId: string;
  /** Item ID */
  itemId: string;
  /** Installed version */
  version: string;
  /** Installation status */
  status: InstallationStatus;
  /** User-specific configuration */
  config?: Record<string, unknown>;
  /** When installed */
  installedAt: string;
  /** When last updated */
  updatedAt: string;
  /** Auto-update enabled */
  autoUpdate: boolean;
  /** Installation error (if failed) */
  error?: string;
}

/**
 * Installation result
 */
export interface InstallationResult {
  /** Success status */
  success: boolean;
  /** Installation record */
  installation?: InstalledItem;
  /** Error message if failed */
  error?: string;
  /** Warnings */
  warnings?: string[];
  /** Dependencies installed */
  dependenciesInstalled?: string[];
}

// ============================================================================
// Marketplace Interface
// ============================================================================

/**
 * Statistics about the marketplace
 */
export interface MarketplaceStats {
  totalItems: number;
  totalPublishers: number;
  totalDownloads: number;
  itemsByType: Record<MarketplaceItemType, number>;
  topCategories: Array<{ name: string; count: number }>;
  recentlyAdded: number;
  averageRating: number;
}

/**
 * Interface for the Agent Marketplace
 */
export interface IMarketplace {
  // ============ Initialization ============
  
  /**
   * Initialize the marketplace
   */
  initialize(): Promise<void>;

  // ============ Search & Discovery ============
  
  /**
   * Search marketplace items
   */
  search(options?: MarketplaceSearchOptions): Promise<MarketplaceSearchResult>;

  /**
   * Get item by ID
   */
  getItem(itemId: string): Promise<MarketplaceItem | undefined>;

  /**
   * Get multiple items by ID
   */
  getItems(itemIds: string[]): Promise<MarketplaceItem[]>;

  /**
   * Get featured items
   */
  getFeatured(type?: MarketplaceItemType, limit?: number): Promise<MarketplaceItem[]>;

  /**
   * Get trending items
   */
  getTrending(type?: MarketplaceItemType, period?: 'day' | 'week' | 'month', limit?: number): Promise<MarketplaceItem[]>;

  /**
   * Get recently added items
   */
  getRecent(type?: MarketplaceItemType, limit?: number): Promise<MarketplaceItem[]>;

  /**
   * Get items by publisher
   */
  getByPublisher(publisherId: string, options?: MarketplaceSearchOptions): Promise<MarketplaceSearchResult>;

  // ============ Item Details ============
  
  /**
   * Get item reviews
   */
  getReviews(itemId: string, options?: { sortBy?: 'newest' | 'helpful' | 'rating'; limit?: number; offset?: number }): Promise<{ reviews: Review[]; total: number }>;

  /**
   * Get item versions
   */
  getVersions(itemId: string): Promise<Array<{ version: string; releasedAt: string; changelog?: string }>>;

  /**
   * Get item dependencies tree
   */
  getDependencyTree(itemId: string): Promise<{ item: MarketplaceItem; dependencies: MarketplaceItem[] }>;

  // ============ Installation ============
  
  /**
   * Install an item
   */
  install(itemId: string, options?: { version?: string; config?: Record<string, unknown>; autoUpdate?: boolean }): Promise<InstallationResult>;

  /**
   * Update an installed item
   */
  update(installationId: string, options?: { version?: string; config?: Record<string, unknown> }): Promise<InstallationResult>;

  /**
   * Uninstall an item
   */
  uninstall(installationId: string): Promise<{ success: boolean; error?: string }>;

  /**
   * Get installed items
   */
  getInstalled(options?: { type?: MarketplaceItemType; status?: InstallationStatus }): Promise<InstalledItem[]>;

  /**
   * Get installation by ID
   */
  getInstallation(installationId: string): Promise<InstalledItem | undefined>;

  /**
   * Check for updates
   */
  checkUpdates(): Promise<Array<{ installation: InstalledItem; latestVersion: string; currentVersion: string }>>;

  // ============ Publishing ============
  
  /**
   * Publish a new item
   */
  publish(item: Omit<MarketplaceItem, 'id' | 'stats' | 'ratings' | 'createdAt' | 'updatedAt' | 'publishedAt'>): Promise<MarketplaceItem>;

  /**
   * Update a published item
   */
  updateItem(itemId: string, updates: Partial<MarketplaceItem>): Promise<MarketplaceItem>;

  /**
   * Publish a new version
   */
  publishVersion(itemId: string, version: string, options?: { changelog?: string; breaking?: boolean }): Promise<void>;

  /**
   * Deprecate an item
   */
  deprecate(itemId: string, reason: string, alternativeId?: string): Promise<void>;

  // ============ Reviews & Ratings ============
  
  /**
   * Submit a review
   */
  submitReview(itemId: string, review: { rating: number; title?: string; body: string }): Promise<Review>;

  /**
   * Update a review
   */
  updateReview(reviewId: string, updates: { rating?: number; title?: string; body?: string }): Promise<Review>;

  /**
   * Delete a review
   */
  deleteReview(reviewId: string): Promise<void>;

  /**
   * Mark review as helpful
   */
  markReviewHelpful(reviewId: string): Promise<void>;

  /**
   * Respond to a review (as publisher)
   */
  respondToReview(reviewId: string, response: string): Promise<void>;

  // ============ Analytics ============
  
  /**
   * Get marketplace statistics
   */
  getStats(): Promise<MarketplaceStats>;

  /**
   * Record item view (for analytics)
   */
  recordView(itemId: string): Promise<void>;

  /**
   * Get item analytics (for publishers)
   */
  getItemAnalytics(itemId: string, period?: 'day' | 'week' | 'month' | 'year'): Promise<{
    views: Array<{ date: string; count: number }>;
    downloads: Array<{ date: string; count: number }>;
    activeInstalls: number;
    uninstalls: number;
    ratings: Array<{ date: string; rating: number }>;
  }>;
}


