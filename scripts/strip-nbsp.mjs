import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'src');
const TARGET_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const isWindows = process.platform === 'win32';

function normalizePath(p) {
  return isWindows && p.startsWith('/') ? p.slice(1) : p;
}

function walk(dir, acc) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (TARGET_EXTS.has(path.extname(entry.name))) {
      acc.push(full);
    }
  }
  return acc;
}

const files = walk(SRC_DIR, []);
let changed = 0;
let stripped = 0;

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const cleaned = raw
    // Normalize NBSP and other exotic spaces to regular space
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    // Remove zero-width chars if any snuck in
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '');

  if (cleaned !== raw) {
    fs.writeFileSync(file, cleaned, 'utf8');
    changed += 1;
    stripped += (raw.length - cleaned.length);
  }
}

console.log(`strip-nbsp: cleaned ${changed} files, removed ${stripped} chars`);


