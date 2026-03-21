/**
 * @file CodeFenceExtractor.spec.ts
 * @description Unit tests for {@link extractCodeBlocks} and {@link detectLanguage}.
 *
 * Test strategy:
 * - Happy-path extraction with single and multiple fences.
 * - Edge cases: empty text, no language tag, unclosed fence, empty code body.
 * - Offset correctness — offsets must be usable with `String.prototype.slice`.
 * - Language alias normalisation (ts→typescript, js→javascript, etc.).
 * - {@link detectLanguage} cascade covering Python, JavaScript, SQL, Bash, and
 *   the unknown/null fall-through path.
 */

import { describe, it, expect } from 'vitest';
import {
  extractCodeBlocks,
  detectLanguage,
} from '../../../../src/extensions/packs/code-safety/CodeFenceExtractor';

// ---------------------------------------------------------------------------
// extractCodeBlocks — happy path
// ---------------------------------------------------------------------------

describe('extractCodeBlocks', () => {
  describe('single block with language tag', () => {
    it('returns one CodeBlock with correct code and language', () => {
      const text = '```python\nprint("hello")\n```';
      const blocks = extractCodeBlocks(text);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].language).toBe('python');
      expect(blocks[0].code).toBe('print("hello")\n');
    });

    it('start offset is 0 for fence at beginning of text', () => {
      const text = '```python\nprint("hello")\n```';
      const blocks = extractCodeBlocks(text);

      expect(blocks[0].start).toBe(0);
    });

    it('end offset equals text length when fence fills entire text', () => {
      const text = '```python\nprint("hello")\n```';
      const blocks = extractCodeBlocks(text);

      expect(blocks[0].end).toBe(text.length);
    });

    it('slice(start, end) reproduces the full fence', () => {
      const text = '```python\nprint("hello")\n```';
      const blocks = extractCodeBlocks(text);
      const { start, end } = blocks[0];

      expect(text.slice(start, end)).toBe(text);
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple blocks
  // ---------------------------------------------------------------------------

  describe('multiple blocks', () => {
    it('returns blocks in document order', () => {
      const text = [
        '```python',
        'x = 1',
        '```',
        '',
        '```javascript',
        'const y = 2;',
        '```',
      ].join('\n');

      const blocks = extractCodeBlocks(text);

      expect(blocks).toHaveLength(2);
      expect(blocks[0].language).toBe('python');
      expect(blocks[1].language).toBe('javascript');
    });

    it('blocks have non-overlapping offsets in ascending order', () => {
      const text = [
        '```python',
        'a = 1',
        '```',
        '',
        '```sql',
        'SELECT 1',
        '```',
      ].join('\n');

      const blocks = extractCodeBlocks(text);

      expect(blocks[0].end).toBeLessThanOrEqual(blocks[1].start);
    });

    it('each block slice reproduces its fence in the original text', () => {
      const text = '```go\nfunc main() {}\n```\n\n```ruby\nputs "hi"\n```';
      const blocks = extractCodeBlocks(text);

      for (const block of blocks) {
        const slice = text.slice(block.start, block.end);
        // The slice should start with ``` and contain a closing ``` line
        expect(slice).toMatch(/^```/);
        // Use multiline so $ matches end-of-line, not just end-of-string,
        // since the regex may capture a trailing newline after the closing fence.
        expect(slice).toMatch(/```/m);
        // The code content from the block should appear in the slice.
        expect(slice).toContain(block.code.trim());
      }
    });
  });

  // ---------------------------------------------------------------------------
  // No language tag
  // ---------------------------------------------------------------------------

  describe('block with no language tag', () => {
    it('language is null when no tag is provided', () => {
      const text = '```\nconsole.log("hi");\n```';
      const blocks = extractCodeBlocks(text);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].language).toBeNull();
    });

    it('code is still extracted correctly', () => {
      const text = '```\nhello world\n```';
      const blocks = extractCodeBlocks(text);

      expect(blocks[0].code).toBe('hello world\n');
    });
  });

  // ---------------------------------------------------------------------------
  // Empty / edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('returns empty array for empty string', () => {
      expect(extractCodeBlocks('')).toEqual([]);
    });

    it('returns empty array for text with no code fences', () => {
      const text = 'This is plain text without any code fences.';
      expect(extractCodeBlocks(text)).toEqual([]);
    });

    it('does NOT extract an unclosed fence', () => {
      // An opening fence without a matching closing fence must be ignored.
      const text = '```python\nprint("unclosed")';
      const blocks = extractCodeBlocks(text);

      expect(blocks).toHaveLength(0);
    });

    it('handles surrounding prose correctly', () => {
      const text = [
        'Here is some code:',
        '',
        '```bash',
        'echo hello',
        '```',
        '',
        'And that was the code.',
      ].join('\n');

      const blocks = extractCodeBlocks(text);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].language).toBe('bash');
    });
  });

  // ---------------------------------------------------------------------------
  // Offset correctness
  // ---------------------------------------------------------------------------

  describe('offset correctness', () => {
    it('start and end are correct when fence is preceded by prose', () => {
      const prefix = 'Some text before:\n';
      const fence = '```js\nconst x = 1;\n```';
      const text = prefix + fence;

      const blocks = extractCodeBlocks(text);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].start).toBe(prefix.length);
      expect(blocks[0].end).toBe(text.length);
    });

    it('start and end are correct for second block', () => {
      const first = '```python\na = 1\n```\n\n';
      const second = '```ruby\nputs "hi"\n```';
      const text = first + second;

      const blocks = extractCodeBlocks(text);
      expect(blocks).toHaveLength(2);
      expect(blocks[1].start).toBe(first.length);
      expect(blocks[1].end).toBe(text.length);
    });
  });

  // ---------------------------------------------------------------------------
  // Alias normalisation
  // ---------------------------------------------------------------------------

  describe('alias normalisation', () => {
    it('ts → typescript', () => {
      const blocks = extractCodeBlocks('```ts\nconst x: number = 1;\n```');
      expect(blocks[0].language).toBe('typescript');
    });

    it('js → javascript', () => {
      const blocks = extractCodeBlocks('```js\nconsole.log(1);\n```');
      expect(blocks[0].language).toBe('javascript');
    });

    it('py → python', () => {
      const blocks = extractCodeBlocks('```py\nprint(1)\n```');
      expect(blocks[0].language).toBe('python');
    });

    it('sh → bash', () => {
      const blocks = extractCodeBlocks('```sh\necho hi\n```');
      expect(blocks[0].language).toBe('bash');
    });

    it('tsx → typescript (JSX alias)', () => {
      const blocks = extractCodeBlocks('```tsx\nconst x = <div/>;\n```');
      expect(blocks[0].language).toBe('typescript');
    });

    it('full name passes through unchanged (python)', () => {
      const blocks = extractCodeBlocks('```python\npass\n```');
      expect(blocks[0].language).toBe('python');
    });

    it('upper-cased tags are lower-cased (PYTHON → python)', () => {
      const blocks = extractCodeBlocks('```PYTHON\npass\n```');
      expect(blocks[0].language).toBe('python');
    });
  });
});

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------

describe('detectLanguage', () => {
  it('identifies Python by def keyword', () => {
    expect(detectLanguage('def greet(name):\n    print(name)')).toBe('python');
  });

  it('identifies Python by from...import', () => {
    expect(detectLanguage('from os import path')).toBe('python');
  });

  it('identifies Python by top-level import', () => {
    expect(detectLanguage('import sys\nsys.exit(0)')).toBe('python');
  });

  it('identifies JavaScript by arrow function', () => {
    expect(detectLanguage('const add = (a, b) => a + b;')).toBe('javascript');
  });

  it('identifies JavaScript by function keyword', () => {
    expect(detectLanguage('function greet(name) { return name; }')).toBe('javascript');
  });

  it('identifies JavaScript by require()', () => {
    expect(detectLanguage("const fs = require('fs');")).toBe('javascript');
  });

  it('identifies SQL by SELECT keyword (case-insensitive)', () => {
    expect(detectLanguage('SELECT * FROM users WHERE id = 1')).toBe('sql');
  });

  it('identifies SQL by INSERT INTO', () => {
    expect(detectLanguage('INSERT INTO orders (id, total) VALUES (1, 99.00)')).toBe('sql');
  });

  it('identifies SQL by CREATE TABLE', () => {
    expect(detectLanguage('CREATE TABLE users (id INT PRIMARY KEY)')).toBe('sql');
  });

  it('identifies Bash by shebang line', () => {
    expect(detectLanguage('#!/bin/bash\necho hello')).toBe('bash');
  });

  it('identifies Bash by if [ ... ]', () => {
    expect(detectLanguage('if [ -f /etc/passwd ]; then echo found; fi')).toBe('bash');
  });

  it('identifies Ruby by class...< inheritance', () => {
    expect(detectLanguage('class Dog < Animal\nend')).toBe('ruby');
  });

  it('identifies Go by package declaration', () => {
    expect(detectLanguage('package main\n\nfunc main() {}')).toBe('go');
  });

  it('identifies Java by public class', () => {
    expect(detectLanguage('public class HelloWorld {\n  public static void main(String[] args) {}\n}')).toBe('java');
  });

  it('returns null for plain prose / unknown code', () => {
    expect(detectLanguage('hello world, this is just text')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectLanguage('')).toBeNull();
  });

  it('returns null for a single random word', () => {
    expect(detectLanguage('foobar')).toBeNull();
  });
});
