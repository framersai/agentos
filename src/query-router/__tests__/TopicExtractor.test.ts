/**
 * @fileoverview Tests for TopicExtractor.
 *
 * Verifies topic extraction from corpus chunks including deduplication,
 * prompt formatting, topic capping, and empty-input handling.
 */

import type { CorpusChunk, TopicEntry } from '../../query-router/types.js';
import { TopicExtractor } from '../TopicExtractor.js';

describe('TopicExtractor', () => {
  let extractor: TopicExtractor;

  beforeEach(() => {
    extractor = new TopicExtractor();
  });

  it('extracts unique topics from chunks (dedup by heading::source)', () => {
    const chunks: CorpusChunk[] = [
      { id: '1', content: 'Auth flow details...', heading: 'Authentication', sourcePath: 'docs/auth.md' },
      { id: '2', content: 'More auth info...', heading: 'Authentication', sourcePath: 'docs/auth.md' },
      { id: '3', content: 'DB schema info...', heading: 'Database', sourcePath: 'docs/database.md' },
      { id: '4', content: 'Auth tokens...', heading: 'Authentication', sourcePath: 'docs/tokens.md' },
    ];

    const topics = extractor.extract(chunks);

    // Should deduplicate: chunks 1 and 2 share heading::sourcePath
    expect(topics).toHaveLength(3);

    // Should be sorted alphabetically by name
    expect(topics[0].name).toBe('Authentication');
    expect(topics[0].source).toBe('docs/auth.md');

    expect(topics[1].name).toBe('Authentication');
    expect(topics[1].source).toBe('docs/tokens.md');

    expect(topics[2].name).toBe('Database');
    expect(topics[2].source).toBe('docs/database.md');
  });

  it('formats topics as compact string (one line per topic)', () => {
    const topics: TopicEntry[] = [
      { name: 'Authentication', source: 'docs/auth.md' },
      { name: 'Database', source: 'docs/database.md' },
      { name: 'Deployment', source: 'docs/deploy.md' },
    ];

    const formatted = extractor.formatForPrompt(topics);

    const lines = formatted.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Authentication (docs/auth.md)');
    expect(lines[1]).toBe('Database (docs/database.md)');
    expect(lines[2]).toBe('Deployment (docs/deploy.md)');
  });

  it('caps topics at maxTopics', () => {
    const chunks: CorpusChunk[] = Array.from({ length: 100 }, (_, i) => ({
      id: `chunk-${i}`,
      content: `Content for topic ${i}`,
      heading: `Topic ${String(i).padStart(3, '0')}`,
      sourcePath: `docs/topic-${i}.md`,
    }));

    // Default cap is 50
    const defaultTopics = extractor.extract(chunks);
    expect(defaultTopics).toHaveLength(50);

    // Custom cap
    const cappedTopics = extractor.extract(chunks, { maxTopics: 10 });
    expect(cappedTopics).toHaveLength(10);
  });

  it('returns empty array for empty input', () => {
    const topics = extractor.extract([]);

    expect(topics).toEqual([]);
  });
});
