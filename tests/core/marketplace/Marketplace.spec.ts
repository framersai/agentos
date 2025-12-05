/**
 * @file Marketplace.spec.ts
 * @description Unit tests for the Marketplace class.
 * @module AgentOS/Marketplace/Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Marketplace } from '../../../src/core/marketplace/Marketplace';
import type {
  MarketplaceItem,
  MarketplaceSearchOptions,
  PublisherInfo,
  PricingInfo,
} from '../../../src/core/marketplace/IMarketplace';

describe('Marketplace', () => {
  let marketplace: Marketplace;

  const testPublisher: PublisherInfo = {
    id: 'pub-test',
    name: 'Test Publisher',
    type: 'individual',
    verified: false,
  };

  const testPricing: PricingInfo = { model: 'free' };

  beforeEach(async () => {
    marketplace = new Marketplace({ userId: 'test-user' });
    await marketplace.initialize();
  });

  describe('Search & Discovery', () => {
    it('should return seeded items on search', async () => {
      const result = await marketplace.search();

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(0);
      expect(result.facets).toBeDefined();
    });

    it('should search by query text', async () => {
      const result = await marketplace.search({ query: 'research' });

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.some(i => i.name.toLowerCase().includes('research') || i.description.toLowerCase().includes('research'))).toBe(true);
    });

    it('should filter by type', async () => {
      const result = await marketplace.search({ types: ['agent'] });

      expect(result.items.every(i => i.type === 'agent')).toBe(true);
    });

    it('should filter by category', async () => {
      const result = await marketplace.search({ categories: ['productivity'] });

      expect(result.items.every(i => i.categories.includes('productivity'))).toBe(true);
    });

    it('should sort by downloads', async () => {
      // Add item with downloads
      const item = await marketplace.publish({
        type: 'agent',
        name: 'Popular Agent',
        description: 'Very popular',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['popular'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      // Simulate downloads
      await marketplace.install(item.id);
      await marketplace.install(item.id).catch(() => {}); // Will fail but we don't care

      const result = await marketplace.search({ sortBy: 'downloads', sortDirection: 'desc' });
      expect(result.items[0].stats.downloads).toBeGreaterThanOrEqual(result.items[result.items.length - 1].stats.downloads);
    });

    it('should paginate results', async () => {
      const page1 = await marketplace.search({ limit: 2, offset: 0 });
      const page2 = await marketplace.search({ limit: 2, offset: 2 });

      expect(page1.items.length).toBeLessThanOrEqual(2);
      expect(page1.searchMeta.offset).toBe(0);
      expect(page2.searchMeta.offset).toBe(2);
    });

    it('should get featured items', async () => {
      const featured = await marketplace.getFeatured();

      expect(Array.isArray(featured)).toBe(true);
    });

    it('should get trending items', async () => {
      const trending = await marketplace.getTrending();

      expect(Array.isArray(trending)).toBe(true);
    });

    it('should get recent items', async () => {
      const recent = await marketplace.getRecent();

      expect(Array.isArray(recent)).toBe(true);
      // Should be sorted by date (newest first)
      for (let i = 0; i < recent.length - 1; i++) {
        const date1 = new Date(recent[i].publishedAt || recent[i].createdAt);
        const date2 = new Date(recent[i + 1].publishedAt || recent[i + 1].createdAt);
        expect(date1.getTime()).toBeGreaterThanOrEqual(date2.getTime());
      }
    });
  });

  describe('Item Operations', () => {
    it('should get item by ID', async () => {
      const result = await marketplace.search({ limit: 1 });
      const itemId = result.items[0].id;

      const item = await marketplace.getItem(itemId);

      expect(item).toBeDefined();
      expect(item?.id).toBe(itemId);
    });

    it('should get multiple items by ID', async () => {
      const result = await marketplace.search({ limit: 2 });
      const itemIds = result.items.map(i => i.id);

      const items = await marketplace.getItems(itemIds);

      expect(items.length).toBe(itemIds.length);
    });

    it('should return undefined for non-existent item', async () => {
      const item = await marketplace.getItem('non-existent-id');

      expect(item).toBeUndefined();
    });

    it('should get item versions', async () => {
      const result = await marketplace.search({ limit: 1 });
      const itemId = result.items[0].id;

      const versions = await marketplace.getVersions(itemId);

      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThan(0);
    });

    it('should get dependency tree', async () => {
      const result = await marketplace.search({ limit: 1 });
      const itemId = result.items[0].id;

      const tree = await marketplace.getDependencyTree(itemId);

      expect(tree.item).toBeDefined();
      expect(Array.isArray(tree.dependencies)).toBe(true);
    });
  });

  describe('Publishing', () => {
    it('should publish a new item', async () => {
      const item = await marketplace.publish({
        type: 'persona',
        name: 'Test Persona',
        description: 'A test persona',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: ['test', 'unit-test'],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      expect(item.id).toBeDefined();
      expect(item.name).toBe('Test Persona');
      expect(item.stats).toBeDefined();
      expect(item.ratings).toBeDefined();
      expect(item.createdAt).toBeDefined();
    });

    it('should update an item', async () => {
      const item = await marketplace.publish({
        type: 'agent',
        name: 'Update Test',
        description: 'Original description',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      const updated = await marketplace.updateItem(item.id, {
        description: 'Updated description',
      });

      expect(updated.description).toBe('Updated description');
      expect(updated.updatedAt).toBeDefined();
    });

    it('should publish a new version', async () => {
      const item = await marketplace.publish({
        type: 'extension',
        name: 'Version Test',
        description: 'Test',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      await marketplace.publishVersion(item.id, '1.1.0', { changelog: 'New features' });

      const updated = await marketplace.getItem(item.id);
      expect(updated?.version).toBe('1.1.0');
    });

    it('should deprecate an item', async () => {
      const item = await marketplace.publish({
        type: 'workflow',
        name: 'Deprecate Test',
        description: 'Test',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      await marketplace.deprecate(item.id, 'Replaced by newer version');

      const deprecated = await marketplace.getItem(item.id);
      expect(deprecated?.status).toBe('deprecated');
    });
  });

  describe('Installation', () => {
    it('should install an item', async () => {
      const item = await marketplace.publish({
        type: 'agent',
        name: 'Install Test',
        description: 'Test',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      const result = await marketplace.install(item.id);

      expect(result.success).toBe(true);
      expect(result.installation).toBeDefined();
      expect(result.installation?.itemId).toBe(item.id);
      expect(result.installation?.status).toBe('installed');
    });

    it('should not install duplicate', async () => {
      const item = await marketplace.publish({
        type: 'agent',
        name: 'Duplicate Test',
        description: 'Test',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      await marketplace.install(item.id);
      const result = await marketplace.install(item.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain('already installed');
    });

    it('should update installation config', async () => {
      const item = await marketplace.publish({
        type: 'extension',
        name: 'Config Test',
        description: 'Test',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
        defaultConfig: { setting: 'default' },
      });

      const install = await marketplace.install(item.id);
      const result = await marketplace.update(install.installation!.installationId, {
        config: { setting: 'updated' },
      });

      expect(result.success).toBe(true);
      expect(result.installation?.config?.setting).toBe('updated');
    });

    it('should uninstall an item', async () => {
      const item = await marketplace.publish({
        type: 'persona',
        name: 'Uninstall Test',
        description: 'Test',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      const install = await marketplace.install(item.id);
      const result = await marketplace.uninstall(install.installation!.installationId);

      expect(result.success).toBe(true);

      const installation = await marketplace.getInstallation(install.installation!.installationId);
      expect(installation).toBeUndefined();
    });

    it('should list installed items', async () => {
      const item = await marketplace.publish({
        type: 'agent',
        name: 'List Test',
        description: 'Test',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      await marketplace.install(item.id);

      const installed = await marketplace.getInstalled();

      expect(installed.length).toBeGreaterThan(0);
      expect(installed.some(i => i.itemId === item.id)).toBe(true);
    });

    it('should check for updates', async () => {
      const item = await marketplace.publish({
        type: 'extension',
        name: 'Update Check Test',
        description: 'Test',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      await marketplace.install(item.id);
      await marketplace.publishVersion(item.id, '1.1.0');

      const updates = await marketplace.checkUpdates();

      expect(updates.length).toBeGreaterThan(0);
      expect(updates.some(u => u.installation.itemId === item.id)).toBe(true);
    });
  });

  describe('Reviews & Ratings', () => {
    it('should submit a review', async () => {
      const item = await marketplace.publish({
        type: 'agent',
        name: 'Review Test',
        description: 'Test',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      const review = await marketplace.submitReview(item.id, {
        rating: 5,
        title: 'Great!',
        body: 'This is excellent.',
      });

      expect(review.id).toBeDefined();
      expect(review.rating).toBe(5);

      const updatedItem = await marketplace.getItem(item.id);
      expect(updatedItem?.ratings.count).toBe(1);
      expect(updatedItem?.ratings.average).toBe(5);
    });

    it('should update a review', async () => {
      const item = await marketplace.publish({
        type: 'persona',
        name: 'Review Update Test',
        description: 'Test',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      const review = await marketplace.submitReview(item.id, {
        rating: 3,
        body: 'It\'s okay.',
      });

      const updated = await marketplace.updateReview(review.id, {
        rating: 4,
        body: 'Actually pretty good!',
      });

      expect(updated.rating).toBe(4);
      expect(updated.body).toBe('Actually pretty good!');
    });

    it('should get reviews for an item', async () => {
      const item = await marketplace.publish({
        type: 'workflow',
        name: 'Reviews List Test',
        description: 'Test',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      await marketplace.submitReview(item.id, { rating: 5, body: 'Great!' });
      await marketplace.submitReview(item.id, { rating: 4, body: 'Good' });

      const { reviews, total } = await marketplace.getReviews(item.id);

      expect(total).toBe(2);
      expect(reviews.length).toBe(2);
    });

    it('should mark review as helpful', async () => {
      const item = await marketplace.publish({
        type: 'extension',
        name: 'Helpful Test',
        description: 'Test',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      const review = await marketplace.submitReview(item.id, { rating: 5, body: 'Helpful review' });
      await marketplace.markReviewHelpful(review.id);

      const { reviews } = await marketplace.getReviews(item.id);
      expect(reviews[0].helpfulVotes).toBe(1);
    });
  });

  describe('Analytics', () => {
    it('should get marketplace stats', async () => {
      const stats = await marketplace.getStats();

      expect(stats.totalItems).toBeGreaterThan(0);
      expect(stats.itemsByType).toBeDefined();
      expect(stats.topCategories).toBeDefined();
    });

    it('should record views', async () => {
      // Create a fresh item to avoid conflicts with seeded data
      const item = await marketplace.publish({
        type: 'agent',
        name: 'Views Test',
        description: 'Test',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      // New item starts with 0 views
      expect(item.stats.views).toBe(0);
      
      await marketplace.recordView(item.id);
      const after = await marketplace.getItem(item.id);

      // After recording one view, should have 1 view
      expect(after?.stats.views).toBe(1);
    });

    it('should get item analytics', async () => {
      const item = await marketplace.publish({
        type: 'agent',
        name: 'Analytics Test',
        description: 'Test',
        version: '1.0.0',
        publisher: testPublisher,
        visibility: 'public',
        status: 'published',
        categories: ['test'],
        tags: [],
        license: 'MIT',
        pricing: testPricing,
        agentosVersion: '^2.0.0',
      });

      const analytics = await marketplace.getItemAnalytics(item.id);

      expect(analytics.views).toBeDefined();
      expect(analytics.downloads).toBeDefined();
      expect(analytics.activeInstalls).toBeDefined();
    });
  });
});

