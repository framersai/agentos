import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const pkg = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8'));

test('package exports only point at shipped files', () => {
  const missing = [];

  for (const [subpath, target] of Object.entries(pkg.exports)) {
    const entries = typeof target === 'string' ? [target] : Object.values(target);
    for (const entry of entries) {
      if (typeof entry !== 'string') {
        continue;
      }
      if (entry.includes('*')) {
        continue;
      }
      if (entry === './package.json') {
        continue;
      }
      const absolutePath = resolve(pkgRoot, entry);
      if (!existsSync(absolutePath)) {
        missing.push(`${subpath} -> ${entry}`);
      }
    }
  }

  assert.deepEqual(missing, []);
});
