/**
 * @fileoverview Vitest global setup.
 *
 * Generates the platform knowledge corpus (knowledge/platform-corpus.json)
 * before the test run so corpus-dependent tests (QueryClassifier's catalog
 * fallback, platform-knowledge) can read it. The corpus is gitignored and
 * generated; in standalone CI the sibling-package sources are absent but the
 * generator skips them gracefully, leaving the static content the tests assert
 * on. Failure is non-fatal: corpus-dependent tests will simply not find it.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default function setup() {
  try {
    execSync('node scripts/build-knowledge-corpus.mjs', { cwd: PKG_ROOT, stdio: 'pipe' });
  } catch (err) {
    console.warn(
      '[vitest] knowledge corpus generation failed; corpus-dependent tests may not find it:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
