#!/usr/bin/env node
/**
 * One-shot codemod: lift src/orchestration/agents/ → src/agents/.
 *
 * Run AFTER `git mv src/orchestration/agents src/agents`. Rewrites every
 * relative import in src/ so it points at the post-move location.
 *
 * Idempotent — running twice is a no-op because each import's new spec is
 * computed from its target's actual on-disk location, and only rewritten
 * when it differs from the current spec.
 *
 * Usage: cd packages/agentos && node scripts/codemod-agents-lift.mjs
 */

import { Project, SyntaxKind } from 'ts-morph';
import * as path from 'node:path';

const MOVES = {
  'orchestration/agents': 'agents',
};

const OLD_PREFIXES_LONG_FIRST = Object.keys(MOVES).sort((a, b) => b.length - a.length);
const NEW_TO_OLD = Object.fromEntries(Object.entries(MOVES).map(([o, n]) => [n, o]));
const NEW_PREFIXES_LONG_FIRST = Object.values(MOVES).sort((a, b) => b.length - a.length);

function newToOld(srcRelPath) {
  const p = srcRelPath.replace(/\\/g, '/');
  for (const newPrefix of NEW_PREFIXES_LONG_FIRST) {
    if (p === newPrefix || p.startsWith(newPrefix + '/')) {
      const oldPrefix = NEW_TO_OLD[newPrefix];
      return oldPrefix + p.slice(newPrefix.length);
    }
  }
  return p;
}

function oldToNew(srcRelPath) {
  const p = srcRelPath.replace(/\\/g, '/');
  for (const oldPrefix of OLD_PREFIXES_LONG_FIRST) {
    if (p === oldPrefix || p.startsWith(oldPrefix + '/')) {
      return MOVES[oldPrefix] + p.slice(oldPrefix.length);
    }
  }
  return p;
}

const SRC = path.resolve('src');
const project = new Project({ tsConfigFilePath: 'tsconfig.json' });

let rewriteCount = 0;
let touchedFiles = 0;
const samples = [];

for (const sf of project.getSourceFiles()) {
  const filePath = sf.getFilePath();
  if (!filePath.startsWith(SRC + '/') && !filePath.startsWith(SRC + path.sep)) continue;

  const fileNewRel = path.relative(SRC, filePath);
  const fileOldRel = newToOld(fileNewRel);
  const fileOldDir = path.posix.dirname(fileOldRel.replace(/\\/g, '/'));
  const fileNewDir = path.posix.dirname(fileNewRel.replace(/\\/g, '/'));

  let touched = false;

  const rewriteSpec = (spec) => {
    if (!spec) return null;
    if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
    const targetOldRelRaw = path.posix.normalize(path.posix.join(fileOldDir, spec));
    const targetNewRelRaw = oldToNew(targetOldRelRaw);
    let newRelative = path.posix.relative(fileNewDir, targetNewRelRaw);
    if (!newRelative.startsWith('.')) newRelative = './' + newRelative;
    return newRelative === spec ? null : newRelative;
  };

  for (const decl of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
    const spec = decl.getModuleSpecifierValue?.();
    const newSpec = rewriteSpec(spec);
    if (newSpec) {
      decl.setModuleSpecifier(newSpec);
      rewriteCount++;
      touched = true;
      if (samples.length < 6) samples.push(`  ${fileNewRel}: '${spec}' -> '${newSpec}'`);
    }
  }

  sf.forEachDescendant((node) => {
    if (node.getKind() === SyntaxKind.CallExpression) {
      const callExpr = node;
      const expr = callExpr.getExpression();
      if (expr && expr.getKind() === SyntaxKind.ImportKeyword) {
        const args = callExpr.getArguments();
        if (args.length >= 1 && args[0].getKind() === SyntaxKind.StringLiteral) {
          const lit = args[0];
          const spec = lit.getLiteralValue();
          const newSpec = rewriteSpec(spec);
          if (newSpec) {
            lit.setLiteralValue(newSpec);
            rewriteCount++;
            touched = true;
            if (samples.length < 6) samples.push(`  ${fileNewRel}: import('${spec}') -> import('${newSpec}')`);
          }
        }
      }
    }
    if (node.getKind() === SyntaxKind.ImportType) {
      const importTypeNode = node;
      const arg = importTypeNode.getArgument();
      if (arg && arg.getKind() === SyntaxKind.LiteralType) {
        const lit = arg.getLiteral();
        if (lit && lit.getKind() === SyntaxKind.StringLiteral) {
          const spec = lit.getLiteralValue();
          const newSpec = rewriteSpec(spec);
          if (newSpec) {
            lit.setLiteralValue(newSpec);
            rewriteCount++;
            touched = true;
            if (samples.length < 6) samples.push(`  ${fileNewRel}: import('${spec}').X -> import('${newSpec}').X`);
          }
        }
      }
    }
  });

  if (touched) touchedFiles++;
}

await project.save();
console.log(`Rewrote ${rewriteCount} relative imports across ${touchedFiles} files.`);
if (samples.length) {
  console.log('Samples:');
  for (const s of samples) console.log(s);
}
