#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const enableWatch = process.argv.includes('--watch');

const SEARCHABLE_KINDS = new Map([
  [128, { label: 'Class', folder: 'classes' }],
  [256, { label: 'Interface', folder: 'interfaces' }],
  [2097152, { label: 'Type', folder: 'types' }],
  [64, { label: 'Function', folder: 'functions' }],
  [32, { label: 'Variable', folder: 'variables' }],
  [8, { label: 'Enum', folder: 'enums' }],
  [2, { label: 'Module', folder: 'modules' }],
]);

const SURFACES = [
  {
    surface: 'Public API',
    typedocJson: path.join(repoRoot, 'docs-generated', 'library', 'public', 'docs.json'),
    htmlRoot: path.join(repoRoot, 'packages', 'agentos', 'docs', 'api'),
    output: path.join(repoRoot, 'docs-generated', 'library', 'public', 'search-index.json'),
    baseUrl: 'https://docs.agentos.sh/api/',
  },
  {
    surface: 'Module API',
    typedocJson: path.join(repoRoot, 'docs-generated', 'library', 'modules', 'docs.json'),
    htmlRoot: path.join(repoRoot, 'packages', 'agentos', 'docs', 'api', 'modules'),
    output: path.join(repoRoot, 'docs-generated', 'library', 'modules', 'search-index.json'),
    baseUrl: 'https://docs.agentos.sh/api/modules/',
  },
];

function extractSummary(node) {
  const summary = node?.comment?.summary;
  if (Array.isArray(summary) && summary.length > 0) {
    return summary
      .map((entry) => entry?.text ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (typeof node?.comment?.shortText === 'string') {
    return node.comment.shortText.trim();
  }

  if (typeof node?.comment?.text === 'string') {
    return node.comment.text.trim();
  }

  return undefined;
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function walkHtmlFiles(dir, files = []) {
  if (!fs.existsSync(dir)) {
    return files;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkHtmlFiles(fullPath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
}

function buildHtmlIndex(htmlRoot) {
  const files = walkHtmlFiles(htmlRoot);
  const exact = new Map();
  const suffix = new Map();
  const byFolder = new Map();

  for (const file of files) {
    const relativePath = toPosixPath(path.relative(htmlRoot, file));
    const folder = relativePath.includes('/') ? relativePath.slice(0, relativePath.indexOf('/')) : '';
    const baseName = path.basename(file, '.html');
    const suffixName = baseName.includes('.') ? baseName.slice(baseName.lastIndexOf('.') + 1) : baseName;

    const add = (map, key) => {
      if (!key) return;
      const current = map.get(key) ?? [];
      current.push(relativePath);
      map.set(key, current);
    };

    add(exact, baseName, relativePath);
    if (suffixName !== baseName) {
      add(suffix, suffixName, relativePath);
    }

    const folderMaps = byFolder.get(folder) ?? { exact: new Map(), suffix: new Map() };
    add(folderMaps.exact, baseName, relativePath);
    if (suffixName !== baseName) {
      add(folderMaps.suffix, suffixName, relativePath);
    }
    byFolder.set(folder, folderMaps);
  }

  return { exact, suffix, byFolder };
}

function pickBestMatch(candidates) {
  if (!candidates || candidates.length === 0) {
    return undefined;
  }

  return [...candidates].sort((left, right) => {
    const leftDepth = left.split('/').length;
    const rightDepth = right.split('/').length;
    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }
    return left.length - right.length;
  })[0];
}

function resolveDocPath(node, htmlIndex) {
  const kindEntry = SEARCHABLE_KINDS.get(node.kind);
  if (!kindEntry) {
    return undefined;
  }

  const folderMaps = htmlIndex.byFolder.get(kindEntry.folder);
  const exactMatch =
    pickBestMatch(folderMaps?.exact.get(node.name)) ??
    pickBestMatch(folderMaps?.suffix.get(node.name)) ??
    pickBestMatch(htmlIndex.exact.get(node.name)) ??
    pickBestMatch(htmlIndex.suffix.get(node.name));

  if (exactMatch) {
    return exactMatch;
  }

  if (node.kind === 2) {
    return 'modules/index.html';
  }

  return undefined;
}

function collectSearchItems(node, htmlIndex, baseUrl, surface, items, seen) {
  if (!node || typeof node !== 'object') {
    return;
  }

  const kindEntry = SEARCHABLE_KINDS.get(node.kind);
  if (kindEntry && node.name && !node.name.startsWith('__')) {
    const docPath = resolveDocPath(node, htmlIndex);
    if (docPath) {
      const url = new URL(docPath, baseUrl).toString();
      const key = `${surface}:${url}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push({
          name: node.name,
          kind: kindEntry.label,
          url,
          description: extractSummary(node),
          surface,
        });
      }
    }
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectSearchItems(child, htmlIndex, baseUrl, surface, items, seen);
    }
  }
}

function generateSurfaceIndex(config) {
  if (!fs.existsSync(config.typedocJson)) {
    console.warn(`[docs] Skipping ${config.surface}; missing ${path.relative(repoRoot, config.typedocJson)}`);
    return null;
  }

  if (!fs.existsSync(config.htmlRoot)) {
    console.warn(`[docs] Skipping ${config.surface}; missing ${path.relative(repoRoot, config.htmlRoot)}`);
    return null;
  }

  const typedocTree = JSON.parse(fs.readFileSync(config.typedocJson, 'utf8'));
  const htmlIndex = buildHtmlIndex(config.htmlRoot);
  const items = [];
  const seen = new Set();

  collectSearchItems(typedocTree, htmlIndex, config.baseUrl, config.surface, items, seen);
  items.sort((left, right) => left.name.localeCompare(right.name));

  fs.mkdirSync(path.dirname(config.output), { recursive: true });
  fs.writeFileSync(config.output, JSON.stringify(items, null, 2));

  console.log(
    `[docs] Generated ${items.length} search entries for ${config.surface} -> ${path.relative(repoRoot, config.output)}`,
  );

  return items.length;
}

function runOnce() {
  let total = 0;
  for (const surface of SURFACES) {
    total += generateSurfaceIndex(surface) ?? 0;
  }
  return total;
}

runOnce();

if (enableWatch) {
  console.log('[docs] Watching AgentOS TypeDoc outputs for search index updates...');
  let debounceTimer = null;

  const scheduleRun = () => {
    if (debounceTimer) {
      return;
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      runOnce();
    }, 250);
  };

  const watchTargets = [
    path.join(repoRoot, 'docs-generated', 'library'),
    path.join(repoRoot, 'packages', 'agentos', 'docs', 'api'),
  ];

  for (const target of watchTargets) {
    if (!fs.existsSync(target)) {
      continue;
    }
    try {
      fs.watch(target, { recursive: true }, scheduleRun);
    } catch (error) {
      console.warn(`[docs] Unable to watch ${path.relative(repoRoot, target)}: ${error.message}`);
    }
  }
}
