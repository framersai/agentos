#!/usr/bin/env node
/**
 * Recovery codemod for double-rewrite damage from codemod-relative-paths.
 *
 * Symptom: imports like `'../../../core/embeddings/X.js'` that should be
 * `'../../core/embeddings/X.js'` (one fewer `../` level). Caused by running
 * the relative-path codemod twice.
 *
 * Fix algorithm: for each relative import that DOESN'T resolve to an existing
 * file, try dropping one leading `../` and check if the result resolves.
 * Apply the fix only if the dropped-level variant points at a real file.
 *
 * Idempotent. Doesn't touch correctly-resolving imports.
 *
 * Handles: static `import ... from`, `export ... from`, dynamic `import()`,
 * type-position `import('').X`. All four shapes need fixing.
 *
 * Usage: cd packages/agentos && node scripts/codemod-recovery.mjs
 */

import { Project, SyntaxKind } from 'ts-morph';
import * as path from 'node:path';
import * as fs from 'node:fs';

const SRC = path.resolve('src');

const project = new Project({ tsConfigFilePath: 'tsconfig.json' });

let fixedCount = 0;
let touchedFiles = 0;
const unfixed = [];

/**
 * Returns true if the given relative spec resolves to an existing file from fileDir.
 * Tries common TS/JS extension variations.
 */
function resolves(fileDir, spec) {
  if (!spec) return false;
  const base = path.resolve(fileDir, spec);
  const candidates = [
    base,
    base + '.ts',
    base + '.tsx',
    base + '.d.ts',
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    base.replace(/\.js$/, '.d.ts'),
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base.replace(/\.js$/, ''), 'index.ts'),
    path.join(base.replace(/\.js$/, ''), 'index.tsx'),
  ];
  return candidates.some((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Given a broken spec, return a fixed spec or null. Iteratively drops
 * leading `../` segments and checks if the result resolves. Tries up to
 * 5 levels of dropping (covers single, double, and triple-rewrite cases).
 */
function tryFix(fileDir, spec) {
  if (!spec.startsWith('../')) return null;
  let candidate = spec;
  for (let i = 0; i < 5; i++) {
    if (!candidate.startsWith('../')) break;
    candidate = candidate.slice(3); // drop one '../'
    const finalCandidate = candidate.startsWith('.') ? candidate : './' + candidate;
    if (resolves(fileDir, finalCandidate)) return finalCandidate;
  }
  return null;
}

for (const sf of project.getSourceFiles()) {
  const filePath = sf.getFilePath();
  if (!filePath.startsWith(SRC + path.sep) && !filePath.startsWith(SRC + '/')) continue;

  const fileDir = path.dirname(filePath);
  let touched = false;

  // Try to fix a string-literal node holding a relative import spec
  const tryFixLiteral = (lit, currentSpec, descriptor) => {
    if (!currentSpec || (!currentSpec.startsWith('./') && !currentSpec.startsWith('../'))) return;
    if (resolves(fileDir, currentSpec)) return; // already correct
    const fixed = tryFix(fileDir, currentSpec);
    if (fixed) {
      lit.setLiteralValue(fixed);
      fixedCount++;
      touched = true;
    } else {
      unfixed.push(`${path.relative(SRC, filePath)} ${descriptor}: '${currentSpec}'`);
    }
  };

  // Static imports + exports
  for (const decl of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
    const spec = decl.getModuleSpecifierValue?.();
    if (!spec) continue;
    if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
    if (resolves(fileDir, spec)) continue;
    const fixed = tryFix(fileDir, spec);
    if (fixed) {
      decl.setModuleSpecifier(fixed);
      fixedCount++;
      touched = true;
    } else {
      unfixed.push(`${path.relative(SRC, filePath)} static: '${spec}'`);
    }
  }

  // Dynamic + type-position imports
  sf.forEachDescendant((node) => {
    // Dynamic `import('path')`
    if (node.getKind() === SyntaxKind.CallExpression) {
      const expr = node.getExpression();
      if (expr && expr.getKind() === SyntaxKind.ImportKeyword) {
        const args = node.getArguments();
        if (args.length >= 1 && args[0].getKind() === SyntaxKind.StringLiteral) {
          const lit = args[0];
          tryFixLiteral(lit, lit.getLiteralValue(), 'dynamic');
        }
      }
    }
    // Type-position `import('path').X`
    if (node.getKind() === SyntaxKind.ImportType) {
      const arg = node.getArgument();
      if (arg && arg.getKind() === SyntaxKind.LiteralType) {
        const lit = arg.getLiteral();
        if (lit && lit.getKind() === SyntaxKind.StringLiteral) {
          tryFixLiteral(lit, lit.getLiteralValue(), 'type-import');
        }
      }
    }
  });

  if (touched) touchedFiles++;
}

await project.save();
console.log(`Fixed ${fixedCount} broken imports across ${touchedFiles} files.`);
if (unfixed.length) {
  console.log(`\nCouldn't auto-fix ${unfixed.length} imports — manual review needed:`);
  for (const u of unfixed.slice(0, 30)) console.log(`  ${u}`);
  if (unfixed.length > 30) console.log(`  ... and ${unfixed.length - 30} more`);
}
