#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '..', 'dist');

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
    /(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g,
    /(import\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g
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

if (!fs.existsSync(distDir)) {
  console.log('[agentos fix-esm-imports] dist directory missing; nothing to do.');
  process.exit(0);
}

const jsFiles = collectJsFiles(distDir);
for (const file of jsFiles) {
  rewriteSpecifiers(file);
}

console.log(`[agentos fix-esm-imports] Processed ${jsFiles.length} files under ${distDir}.`);


