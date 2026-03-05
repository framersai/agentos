/**
 * @fileoverview Unit tests for ContentAdaptationEngine — platform-specific content transformation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ContentAdaptationEngine,
  PlatformConstraints,
} from '../../src/social-posting/ContentAdaptationEngine';

describe('ContentAdaptationEngine', () => {
  let engine: ContentAdaptationEngine;

  beforeEach(() => {
    engine = new ContentAdaptationEngine();
  });

  // ==========================================================================
  // adaptContent — multi-platform
  // ==========================================================================
  describe('adaptContent', () => {
    it('adapts content for multiple platforms at once', () => {
      const results = engine.adaptContent(
        'Hello world!',
        ['twitter', 'linkedin', 'instagram'],
        ['hello'],
      );

      expect(Object.keys(results)).toEqual(['twitter', 'linkedin', 'instagram']);
      expect(results.twitter.platform).toBe('twitter');
      expect(results.linkedin.platform).toBe('linkedin');
      expect(results.instagram.platform).toBe('instagram');
    });

    it('returns adapted content for each requested platform', () => {
      const results = engine.adaptContent('Test post', ['twitter', 'bluesky']);
      expect(results.twitter.text).toBeDefined();
      expect(results.bluesky.text).toBeDefined();
    });

    it('works with no hashtags', () => {
      const results = engine.adaptContent('Just text, no tags', ['twitter']);
      expect(results.twitter.text).toBe('Just text, no tags');
      expect(results.twitter.hashtags).toEqual([]);
      expect(results.twitter.truncated).toBe(false);
    });
  });

  // ==========================================================================
  // Platform-specific adaptation
  // ==========================================================================
  describe('platform-specific adaptation', () => {
    describe('twitter', () => {
      it('enforces 280 character limit', () => {
        const longContent = 'A'.repeat(300);
        const results = engine.adaptContent(longContent, ['twitter']);

        expect(results.twitter.text.length).toBeLessThanOrEqual(280);
        expect(results.twitter.truncated).toBe(true);
      });

      it('uses inline hashtag style', () => {
        const results = engine.adaptContent('New feature!', ['twitter'], ['dev', 'launch']);
        // Inline means hashtags appended with a space
        expect(results.twitter.text).toBe('New feature! #dev #launch');
      });

      it('respects max 5 hashtags', () => {
        const tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
        const results = engine.adaptContent('Post', ['twitter'], tags);
        expect(results.twitter.hashtags).toHaveLength(5);
        expect(results.twitter.warnings.some((w) => w.includes('Hashtag count'))).toBe(true);
      });
    });

    describe('linkedin', () => {
      it('enforces 3000 character limit', () => {
        const longContent = 'B'.repeat(3100);
        const results = engine.adaptContent(longContent, ['linkedin']);

        expect(results.linkedin.text.length).toBeLessThanOrEqual(3000);
        expect(results.linkedin.truncated).toBe(true);
      });

      it('uses footer hashtag style', () => {
        const results = engine.adaptContent(
          'Thought leadership post',
          ['linkedin'],
          ['business', 'strategy'],
        );

        // Footer means content + \n\n + hashtags
        expect(results.linkedin.text).toBe(
          'Thought leadership post\n\n#business #strategy',
        );
      });
    });

    describe('bluesky', () => {
      it('enforces 300 character limit', () => {
        const longContent = 'C'.repeat(350);
        const results = engine.adaptContent(longContent, ['bluesky']);

        expect(results.bluesky.text.length).toBeLessThanOrEqual(300);
        expect(results.bluesky.truncated).toBe(true);
      });

      it('does not add hashtags to text (hashtagStyle=none)', () => {
        const results = engine.adaptContent('AT proto', ['bluesky'], ['web3', 'decentralized']);

        // Text should be pure content, no hashtags appended
        expect(results.bluesky.text).toBe('AT proto');
        expect(results.bluesky.hashtags).toEqual([]);
      });

      it('emits a facet warning when hashtags are provided', () => {
        const results = engine.adaptContent('Bluesky post', ['bluesky'], ['hello']);

        expect(
          results.bluesky.warnings.some((w) => w.includes('facets')),
        ).toBe(true);
      });
    });

    describe('instagram', () => {
      it('enforces 2200 character limit', () => {
        const longContent = 'D'.repeat(2300);
        const results = engine.adaptContent(longContent, ['instagram']);

        expect(results.instagram.text.length).toBeLessThanOrEqual(2200);
        expect(results.instagram.truncated).toBe(true);
      });

      it('uses footer hashtag style', () => {
        const results = engine.adaptContent('Visual story', ['instagram'], ['photo', 'art']);

        expect(results.instagram.text).toBe('Visual story\n\n#photo #art');
      });

      it('supports up to 30 hashtags', () => {
        const tags = Array.from({ length: 35 }, (_, i) => `tag${i}`);
        const results = engine.adaptContent('Post', ['instagram'], tags);

        expect(results.instagram.hashtags).toHaveLength(30);
        expect(results.instagram.warnings.some((w) => w.includes('Hashtag count'))).toBe(true);
      });
    });

    describe('mastodon', () => {
      it('adds a content warning reminder', () => {
        const results = engine.adaptContent('Sensitive topic', ['mastodon']);

        expect(
          results.mastodon.warnings.some((w) => w.includes('Content Warning') || w.includes('CW')),
        ).toBe(true);
      });

      it('enforces 500 character limit', () => {
        const longContent = 'E'.repeat(550);
        const results = engine.adaptContent(longContent, ['mastodon']);

        expect(results.mastodon.text.length).toBeLessThanOrEqual(500);
        expect(results.mastodon.truncated).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Hashtag handling
  // ==========================================================================
  describe('hashtag handling', () => {
    it('normalizes hashtags by adding # prefix', () => {
      const results = engine.adaptContent('Post', ['twitter'], ['dev', 'launch']);
      expect(results.twitter.hashtags).toEqual(['#dev', '#launch']);
    });

    it('does not double-add # to already-prefixed tags', () => {
      const results = engine.adaptContent('Post', ['twitter'], ['#dev', 'launch']);
      expect(results.twitter.hashtags).toEqual(['#dev', '#launch']);
    });

    it('deduplicates hashtags (case-insensitive)', () => {
      const results = engine.adaptContent('Post', ['twitter'], ['Dev', 'dev', 'DEV']);
      expect(results.twitter.hashtags).toHaveLength(1);
      expect(results.twitter.hashtags[0]).toBe('#Dev'); // keeps first occurrence
    });

    it('enforces max hashtag count per platform', () => {
      const tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
      const results = engine.adaptContent('Post', ['twitter'], tags);

      // Twitter maxHashtags = 5
      expect(results.twitter.hashtags).toHaveLength(5);
      expect(results.twitter.hashtags).toEqual(['#a', '#b', '#c', '#d', '#e']);
    });

    it('returns empty array for platforms with hashtagStyle=none', () => {
      const results = engine.adaptContent('Post', ['bluesky'], ['tag1', 'tag2']);
      expect(results.bluesky.hashtags).toEqual([]);
    });

    it('places hashtags inline for twitter (space-separated after content)', () => {
      const results = engine.adaptContent('Content', ['twitter'], ['tag']);
      expect(results.twitter.text).toBe('Content #tag');
    });

    it('places hashtags in footer for linkedin (double newline separated)', () => {
      const results = engine.adaptContent('Content', ['linkedin'], ['tag']);
      expect(results.linkedin.text).toBe('Content\n\n#tag');
    });

    it('does not include hashtags in text for none-style platforms', () => {
      const results = engine.adaptContent('Content', ['reddit'], ['tag']);
      expect(results.reddit.text).toBe('Content');
    });
  });

  // ==========================================================================
  // truncateWithEllipsis
  // ==========================================================================
  describe('truncateWithEllipsis', () => {
    it('returns original text when within limit', () => {
      const result = engine.truncateWithEllipsis('Short text', 100);
      expect(result).toBe('Short text');
    });

    it('truncates at word boundary when possible', () => {
      const text = 'The quick brown fox jumps over the lazy dog';
      const result = engine.truncateWithEllipsis(text, 25);

      expect(result.length).toBeLessThanOrEqual(25);
      expect(result).toMatch(/\.\.\.$/);
      // Should break at a word boundary, not mid-word
      expect(result).toBe('The quick brown fox...');
    });

    it('hard-truncates when no word boundary is nearby', () => {
      const text = 'A'.repeat(100);
      const result = engine.truncateWithEllipsis(text, 50);

      expect(result.length).toBeLessThanOrEqual(50);
      expect(result).toMatch(/\.\.\.$/);
      expect(result).toBe('A'.repeat(47) + '...');
    });

    it('handles maxLength smaller than ellipsis length', () => {
      const result = engine.truncateWithEllipsis('Hello world', 2);
      expect(result.length).toBeLessThanOrEqual(2);
      expect(result).toBe('He');
    });

    it('handles exact-length text', () => {
      const text = 'Exact fit!!';
      const result = engine.truncateWithEllipsis(text, text.length);
      expect(result).toBe(text);
    });

    it('handles empty string', () => {
      const result = engine.truncateWithEllipsis('', 100);
      expect(result).toBe('');
    });

    it('handles maxLength of zero', () => {
      const result = engine.truncateWithEllipsis('Some text', 0);
      expect(result).toBe('');
    });
  });

  // ==========================================================================
  // getConstraints
  // ==========================================================================
  describe('getConstraints', () => {
    it('returns correct constraints for twitter', () => {
      const constraints = engine.getConstraints('twitter');
      expect(constraints.maxLength).toBe(280);
      expect(constraints.hashtagStyle).toBe('inline');
      expect(constraints.maxHashtags).toBe(5);
      expect(constraints.supportsMedia).toBe(true);
      expect(constraints.supportsPoll).toBe(true);
      expect(constraints.supportsThreading).toBe(true);
    });

    it('returns correct constraints for instagram', () => {
      const constraints = engine.getConstraints('instagram');
      expect(constraints.maxLength).toBe(2200);
      expect(constraints.hashtagStyle).toBe('footer');
      expect(constraints.maxHashtags).toBe(30);
      expect(constraints.supportsCarousel).toBe(true);
    });

    it('returns correct constraints for bluesky', () => {
      const constraints = engine.getConstraints('bluesky');
      expect(constraints.maxLength).toBe(300);
      expect(constraints.hashtagStyle).toBe('none');
      expect(constraints.maxHashtags).toBe(0);
    });

    it('returns correct constraints for linkedin', () => {
      const constraints = engine.getConstraints('linkedin');
      expect(constraints.maxLength).toBe(3000);
      expect(constraints.hashtagStyle).toBe('footer');
      expect(constraints.maxHashtags).toBe(5);
    });

    it('returns default constraints for unknown platform', () => {
      const constraints = engine.getConstraints('myspace');
      expect(constraints.maxLength).toBe(10000);
      expect(constraints.hashtagStyle).toBe('inline');
      expect(constraints.maxHashtags).toBe(10);
      expect(constraints.supportsMedia).toBe(true);
      expect(constraints.supportsVideo).toBe(true);
      expect(constraints.supportsCarousel).toBe(false);
      expect(constraints.supportsPoll).toBe(false);
      expect(constraints.supportsThreading).toBe(false);
    });

    it('returns constraints for all long-form platforms', () => {
      for (const platform of ['devto', 'hashnode', 'medium', 'wordpress']) {
        const constraints = engine.getConstraints(platform);
        expect(constraints.maxLength).toBe(100000);
        expect(constraints.hashtagStyle).toBe('none');
      }
    });
  });

  // ==========================================================================
  // Warnings
  // ==========================================================================
  describe('warnings', () => {
    it('emits truncation warning when content exceeds limit', () => {
      const longContent = 'X'.repeat(300);
      const results = engine.adaptContent(longContent, ['twitter']);

      expect(results.twitter.warnings.some((w) => w.includes('truncated'))).toBe(true);
      expect(results.twitter.warnings.some((w) => w.includes('280'))).toBe(true);
    });

    it('emits hashtag count warning when tags exceed max', () => {
      const tags = ['a', 'b', 'c', 'd', 'e', 'f'];
      const results = engine.adaptContent('Post', ['twitter'], tags);

      const hashtagWarning = results.twitter.warnings.find((w) =>
        w.includes('Hashtag count'),
      );
      expect(hashtagWarning).toBeDefined();
      expect(hashtagWarning).toContain('6');
      expect(hashtagWarning).toContain('5');
    });

    it('emits bluesky facet warning when hashtags are provided', () => {
      const results = engine.adaptContent('Post', ['bluesky'], ['web3']);

      const facetWarning = results.bluesky.warnings.find((w) =>
        w.includes('facets'),
      );
      expect(facetWarning).toBeDefined();
      expect(facetWarning).toContain('AT Protocol');
    });

    it('does not emit bluesky facet warning when no hashtags are given', () => {
      const results = engine.adaptContent('Post', ['bluesky']);

      expect(
        results.bluesky.warnings.some((w) => w.includes('facets')),
      ).toBe(false);
    });

    it('always emits mastodon CW warning', () => {
      const results = engine.adaptContent('Regular post', ['mastodon']);

      expect(
        results.mastodon.warnings.some(
          (w) => w.includes('Content Warning') || w.includes('CW'),
        ),
      ).toBe(true);
    });

    it('emits no warnings for short content on twitter', () => {
      const results = engine.adaptContent('Short', ['twitter']);
      expect(results.twitter.warnings).toHaveLength(0);
    });

    it('can emit both truncation and hashtag warnings together', () => {
      const longContent = 'Z'.repeat(290);
      const tags = ['a', 'b', 'c', 'd', 'e', 'f'];
      const results = engine.adaptContent(longContent, ['twitter'], tags);

      expect(results.twitter.warnings.some((w) => w.includes('truncated'))).toBe(true);
      expect(results.twitter.warnings.some((w) => w.includes('Hashtag count'))).toBe(true);
    });

    it('sets mediaSupported based on platform constraints', () => {
      const results = engine.adaptContent('Post', ['twitter', 'tiktok']);

      expect(results.twitter.mediaSupported).toBe(true);
      // TikTok does not support static image media
      expect(results.tiktok.mediaSupported).toBe(false);
    });
  });

  // ==========================================================================
  // Footer truncation edge case
  // ==========================================================================
  describe('footer hashtag truncation', () => {
    it('truncates content but preserves footer hashtags when possible', () => {
      // LinkedIn: 3000 char limit, footer hashtags
      const longContent = 'W'.repeat(2995);
      const results = engine.adaptContent(longContent, ['linkedin'], ['tag']);

      // Should be truncated but hashtags preserved in footer
      expect(results.linkedin.truncated).toBe(true);
      expect(results.linkedin.text).toContain('#tag');
      expect(results.linkedin.text.length).toBeLessThanOrEqual(3000);
    });
  });
});
