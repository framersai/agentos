#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '..', 'dist');
const SELF_PACKAGE_NAME = '@framers/agentos';

function collectJsFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsFiles(fullPath));
    } else if (entry.isFile() && fullPath.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function resolveSpecifier(filePath, specifier) {
  if (specifier === SELF_PACKAGE_NAME || specifier.startsWith(`${SELF_PACKAGE_NAME}/`)) {
    const relativeExportPath =
      specifier === SELF_PACKAGE_NAME ? 'index' : specifier.slice(SELF_PACKAGE_NAME.length + 1);
    const targetCandidates = [
      path.resolve(distDir, `${relativeExportPath}.js`),
      path.resolve(distDir, relativeExportPath, 'index.js'),
    ];
    const targetPath = targetCandidates.find((candidate) => fs.existsSync(candidate));
    if (!targetPath) {
      return specifier;
    }

    let relativePath = path.relative(path.dirname(filePath), targetPath).replace(/\\/g, '/');
    if (!relativePath.startsWith('.')) {
      relativePath = `./${relativePath}`;
    }
    return relativePath;
  }

  if (!specifier.startsWith('.')) {
    return specifier;
  }

  const hasKnownExtension = /\.(?:[cm]?js|json|node)$/i.test(specifier);
  if (hasKnownExtension) {
    return specifier;
  }

  const baseDir = path.dirname(filePath);
  const asJs = path.resolve(baseDir, `${specifier}.js`);
  if (fs.existsSync(asJs)) {
    return `${specifier}.js`;
  }

  const asIndex = path.resolve(baseDir, specifier, 'index.js');
  if (fs.existsSync(asIndex)) {
    return `${specifier}/index.js`;
  }

  return specifier;
}

function rewriteSpecifiers(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  let modified = original;
  let changed = false;

  const patterns = [
    // Multi-line aware: `[\s\S]*?` matches anything including newlines, non-greedy, so
    // imports with destructuring across multiple lines (e.g. `import { A,\n B\n} from './X'`)
    // are caught. Anchored to start-of-line by `^` + `m` flag and terminated by the `from`
    // keyword before a quote.
    /(^\s*(?:import|export)\s[\s\S]*?from\s+['"])([^'"]+)(['"])/gm,
    /(import\(\s*['"])([^'"]+)(['"]\s*\))/g
  ];

  for (const pattern of patterns) {
    modified = modified.replace(pattern, (match, prefix, specifier, suffix) => {
      const rewritten = resolveSpecifier(filePath, specifier);
      if (rewritten !== specifier) {
        changed = true;
        return `${prefix}${rewritten}${suffix}`;
      }
      return match;
    });
  }

  if (changed) {
    fs.writeFileSync(filePath, modified, 'utf8');
  }
}

function copyIfPresent(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

if (!fs.existsSync(distDir)) {
  console.log('[agentos fix-esm-imports] dist directory missing; nothing to do.');
  process.exit(0);
}

const jsFiles = collectJsFiles(distDir);
for (const file of jsFiles) {
  rewriteSpecifiers(file);
}

const copiedExtensionSecrets = copyIfPresent(
  path.resolve(distDir, 'core', 'config', 'extension-secrets.json'),
  path.resolve(distDir, 'config', 'extension-secrets.json'),
);

console.log(`[agentos fix-esm-imports] Processed ${jsFiles.length} files under ${distDir}.`);
if (copiedExtensionSecrets) {
  console.log('[agentos fix-esm-imports] Mirrored extension-secrets.json into dist/config for public package exports.');
}
