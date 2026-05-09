#!/usr/bin/env node
/**
 * Codemod for agentos kernel restructure (0.7.0).
 *
 * Rewrites self-reference imports of the form `from '@framers/agentos/<old>'`
 * to `from '@framers/agentos/<new>'`. The OLD_TO_NEW table below is
 * sorted longest-prefix-first so e.g. `rag/reranking` matches before `rag`.
 *
 * Idempotent — safe to run repeatedly. Run AFTER each git mv batch so the
 * import paths catch up with the new directory layout.
 *
 * Cross-boundary RELATIVE imports (e.g. `from '../core/llm/Provider'`) are
 * NOT rewritten by this codemod — they're caught per-task by typecheck after
 * each git mv batch and fixed manually. The dominant import style inside
 * agentos is self-reference (105 occurrences), which is what this handles.
 *
 * Usage:
 *   cd packages/agentos
 *   node scripts/codemod-restructure.mjs
 */

import { Project } from 'ts-morph';
import * as path from 'node:path';
import * as fs from 'node:fs';

const OLD_TO_NEW = {
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
  'telephony': 'io/channels/telephony',
  'social-posting': 'io/channels/social-posting',
  // Safety group
  'provenance': 'safety/provenance',
  'sandbox': 'safety/sandbox',
  'evaluation': 'safety/evaluation',
  'services/user_auth': 'safety/auth',
  // API group
  'structured': 'api/structured',
  // core/* moves to safety/* and elsewhere
  'core/guardrails': 'safety/guardrails',
  'core/safety': 'safety',
  'core/validation': 'safety/validation',
  'core/workspace': 'cognition/marketplace/workspace',
  // Type consolidation
  'types': 'core/types',
  'stubs': 'core/types/stubs',
};

// Sort longest-prefix first so 'rag/reranking' isn't shadowed by 'rag'.
const SORTED_KEYS = Object.keys(OLD_TO_NEW).sort((a, b) => b.length - a.length);
const PREFIX = '@framers/agentos/';

function rewriteSelfRef(importPath) {
  if (!importPath.startsWith(PREFIX)) return null;
  const subpath = importPath.slice(PREFIX.length);
  for (const oldKey of SORTED_KEYS) {
    if (subpath === oldKey || subpath.startsWith(oldKey + '/')) {
      const newKey = OLD_TO_NEW[oldKey];
      const rest = subpath.slice(oldKey.length); // includes leading '/' or empty
      return PREFIX + newKey + rest;
    }
  }
  return null;
}

const SRC_ROOT = path.resolve(process.cwd(), 'src');
if (!fs.existsSync(SRC_ROOT)) {
  console.error(`src/ not found at ${SRC_ROOT}. Run from packages/agentos/.`);
  process.exit(1);
}

const project = new Project({ tsConfigFilePath: path.resolve(process.cwd(), 'tsconfig.json') });
const sourceFiles = project.getSourceFiles();
console.log(`Loaded ${sourceFiles.length} source files.`);

let rewriteCount = 0;
let touchedFileCount = 0;

for (const sf of sourceFiles) {
  let touched = false;
  // Handle `import ... from 'X'`
  for (const decl of sf.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    const newSpec = rewriteSelfRef(spec);
    if (newSpec && newSpec !== spec) {
      decl.setModuleSpecifier(newSpec);
      rewriteCount++;
      touched = true;
    }
  }
  // Handle `export { X } from 'Y'`
  for (const decl of sf.getExportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (!spec) continue;
    const newSpec = rewriteSelfRef(spec);
    if (newSpec && newSpec !== spec) {
      decl.setModuleSpecifier(newSpec);
      rewriteCount++;
      touched = true;
    }
  }
  if (touched) {
    touchedFileCount++;
  }
}

await project.save();
console.log(`Rewrote ${rewriteCount} imports across ${touchedFileCount} files.`);
