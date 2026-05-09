#!/usr/bin/env node
/**
 * Smart relative-path codemod for the kernel restructure.
 *
 * Run AFTER all `git mv` batches are staged. This codemod recomputes every
 * relative import in src/*.ts to point at the correct post-move target.
 *
 * Algorithm:
 *   For each file F at NEW path P_new:
 *     P_old = applyInverseMoves(P_new)            # what was its old path?
 *     For each relative-import spec in F:
 *       targetOld = resolveRelative(P_old, spec)  # what file did it point to before?
 *       targetNew = applyMoves(targetOld)         # where is that file now?
 *       newSpec = relativeFrom(P_new, targetNew)
 *       if newSpec != spec: rewrite
 *
 * Skips: bare module specifiers (`@framers/agentos/...`, `lodash`, etc).
 * Those are handled by codemod-restructure.mjs.
 *
 * Idempotent — running twice is a no-op once paths are correct.
 *
 * Usage: cd packages/agentos && node scripts/codemod-relative-paths.mjs
 */

import { Project, SyntaxKind, Node } from 'ts-morph';
import * as path from 'node:path';

// Move map: { old_path_relative_to_src → new_path_relative_to_src }.
// Sorted longest-prefix first when used.
const MOVES = {
  // Cognition group
  'cognitive_substrate': 'cognition/substrate',
  'cognitive-pipeline': 'orchestration/pipeline',
  'memory': 'cognition/memory',
  'nlp': 'cognition/nlp',
  'rag': 'cognition/rag',
  'emergent': 'cognition/emergent',
  'skills': 'cognition/skills',
  'web-search': 'cognition/web-search',
  'discovery': 'cognition/discovery',
  'marketplace': 'cognition/marketplace',
  // Orchestration group
  'ingest-router': 'orchestration/pipeline/ingest',
  'memory-router': 'orchestration/pipeline/memory',
  'query-router': 'orchestration/pipeline/query',
  'read-router': 'orchestration/pipeline/read',
  'agents': 'orchestration/agents',
  // IO group
  'channels': 'io/channels',
  'speech': 'io/speech',
  'hearing': 'io/hearing',
  'vision': 'io/vision',
  'media': 'io/media',
  'voice-pipeline': 'io/voice-pipeline',
  // Safety group
  'provenance': 'safety/provenance',
  'sandbox': 'safety/sandbox',
  'evaluation': 'safety/evaluation',
  'services/user_auth': 'safety/auth',
  // API group
  'structured': 'api/structured',
  // core/* moves
  'core/guardrails': 'safety/guardrails',
  'core/validation': 'safety/validation',
  'core/workspace': 'cognition/marketplace/workspace',
  // Type consolidation
  'types': 'core/types',
  'stubs': 'core/types/stubs',
};

const OLD_PREFIXES_LONG_FIRST = Object.keys(MOVES).sort((a, b) => b.length - a.length);
const NEW_TO_OLD = Object.fromEntries(Object.entries(MOVES).map(([o, n]) => [n, o]));
const NEW_PREFIXES_LONG_FIRST = Object.values(MOVES).sort((a, b) => b.length - a.length);

/** If srcRelPath has been moved, return its OLD relative path. Else returns unchanged. */
function newToOld(srcRelPath) {
  // Normalize to forward-slash (path.normalize on Unix is fine but be defensive).
  const p = srcRelPath.replace(/\\/g, '/');
  for (const newPrefix of NEW_PREFIXES_LONG_FIRST) {
    if (p === newPrefix || p.startsWith(newPrefix + '/')) {
      const oldPrefix = NEW_TO_OLD[newPrefix];
      return oldPrefix + p.slice(newPrefix.length);
    }
  }
  return p;
}

/** If srcRelPath was an OLD path that moved, return its NEW relative path. Else returns unchanged. */
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

  const fileNewRel = path.relative(SRC, filePath); // e.g. 'cognition/memory/X.ts'
  const fileOldRel = newToOld(fileNewRel);
  const fileOldDir = path.posix.dirname(fileOldRel.replace(/\\/g, '/'));
  const fileNewDir = path.posix.dirname(fileNewRel.replace(/\\/g, '/'));

  let touched = false;

  // Helper: rewrite a relative-import string spec, return new spec or null if unchanged
  const rewriteSpec = (spec) => {
    if (!spec) return null;
    if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
    const targetOldRelRaw = path.posix.normalize(path.posix.join(fileOldDir, spec));
    const targetNewRelRaw = oldToNew(targetOldRelRaw);
    let newRelative = path.posix.relative(fileNewDir, targetNewRelRaw);
    if (!newRelative.startsWith('.')) newRelative = './' + newRelative;
    return newRelative === spec ? null : newRelative;
  };

  // 1) Static import + export declarations
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

  // 2) Dynamic `import('path')` calls AND type-position `import('path').X` expressions
  //    Both manifest as descendants we have to walk for.
  sf.forEachDescendant((node) => {
    // Dynamic runtime import: CallExpression with `import` keyword as expression
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
    // Type-position `import('path').X`: ImportTypeNode
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
