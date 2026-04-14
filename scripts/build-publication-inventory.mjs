#!/usr/bin/env node

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONO_ROOT = resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const {
  publicationManifest,
  buildPublicationInventory,
} = require('../docs/publication-manifest.cjs');

const inventory = buildPublicationInventory(MONO_ROOT);

console.log(
  JSON.stringify(
    {
      summary: {
        totalEntries: publicationManifest.length,
        duplicateDestinations: inventory.duplicates.length,
        missingSources: inventory.missingSources.length,
        stubbedDestinations: inventory.stubbedDestinations.length,
      },
      duplicates: inventory.duplicates,
      missingSources: inventory.missingSources,
      generatedDestinations: inventory.generatedDestinations,
      stubbedDestinations: inventory.stubbedDestinations,
    },
    null,
    2,
  ),
);

if (inventory.duplicates.length > 0 || inventory.missingSources.length > 0) {
  process.exitCode = 1;
}
