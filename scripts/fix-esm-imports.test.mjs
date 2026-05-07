import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findUnfixedRelativeImports } from './fix-esm-imports.mjs';

function makeTempDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-esm-imports-test-'));
  return dir;
}

function writeFile(distDir, relPath, contents) {
  const full = path.join(distDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, 'utf8');
  return full;
}

test('findUnfixedRelativeImports — clean dist returns no issues', () => {
  const dist = makeTempDist();
  try {
    writeFile(
      dist,
      'mod/index.js',
      "export { Foo } from './Foo.js';\nimport bar from './bar/index.js';\n",
    );
    writeFile(dist, 'mod/Foo.js', 'export const Foo = 1;\n');
    writeFile(dist, 'mod/bar/index.js', 'export default 2;\n');

    const issues = findUnfixedRelativeImports(dist);
    assert.equal(issues.length, 0);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test('findUnfixedRelativeImports — flags relative import without extension', () => {
  const dist = makeTempDist();
  try {
    writeFile(
      dist,
      'mod/index.js',
      "export { Foo } from './Foo';\nimport bar from './bar/index.js';\n",
    );
    writeFile(dist, 'mod/Foo.js', 'export const Foo = 1;\n');
    writeFile(dist, 'mod/bar/index.js', 'export default 2;\n');

    const issues = findUnfixedRelativeImports(dist);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].specifier, './Foo');
    assert.match(issues[0].file, /mod\/index\.js$/);
    assert.equal(issues[0].line, 1);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test('findUnfixedRelativeImports — flags dynamic import() without extension', () => {
  const dist = makeTempDist();
  try {
    writeFile(
      dist,
      'mod/index.js',
      "async function load() {\n  return await import('./lazy');\n}\n",
    );
    writeFile(dist, 'mod/lazy.js', 'export default 1;\n');

    const issues = findUnfixedRelativeImports(dist);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].specifier, './lazy');
    assert.equal(issues[0].line, 2);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test('findUnfixedRelativeImports — ignores bare specifiers (npm packages)', () => {
  const dist = makeTempDist();
  try {
    writeFile(
      dist,
      'mod/index.js',
      "import x from 'react';\nimport y from '@scope/pkg';\n",
    );

    const issues = findUnfixedRelativeImports(dist);
    assert.equal(issues.length, 0);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test('findUnfixedRelativeImports — ignores .json and .node extensions', () => {
  const dist = makeTempDist();
  try {
    writeFile(
      dist,
      'mod/index.js',
      "import data from './data.json';\nimport native from './native.node';\n",
    );
    writeFile(dist, 'mod/data.json', '{}\n');

    const issues = findUnfixedRelativeImports(dist);
    assert.equal(issues.length, 0);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test('findUnfixedRelativeImports — does not match `import` keyword inside JSDoc comments', () => {
  const dist = makeTempDist();
  try {
    writeFile(
      dist,
      'mod/index.js',
      [
        '/**',
        ' * Example:',
        " *   import { Foo } from './Foo';",
        ' */',
        "export { Foo } from './Foo.js';",
      ].join('\n'),
    );
    writeFile(dist, 'mod/Foo.js', 'export const Foo = 1;\n');

    const issues = findUnfixedRelativeImports(dist);
    assert.equal(issues.length, 0);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
