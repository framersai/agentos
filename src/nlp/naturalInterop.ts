/**
 * @fileoverview Synchronous interop helpers for the CommonJS `natural` package
 * from AgentOS's ESM runtime.
 * @module agentos/nlp/naturalInterop
 */

import { createRequire } from 'node:module';

type NaturalModule = {
  stopwords?: string[];
  PorterStemmer?: { stem(word: string): string };
  LancasterStemmer?: { stem(word: string): string };
};

let cachedNaturalModule: NaturalModule | null | undefined;

function normalizeNaturalModule(moduleValue: unknown): NaturalModule | null {
  const candidate = (moduleValue as { default?: unknown; ['module.exports']?: unknown } | null)?.default
    ?? (moduleValue as { ['module.exports']?: unknown } | null)?.['module.exports']
    ?? moduleValue;

  return candidate && typeof candidate === 'object' ? (candidate as NaturalModule) : null;
}

/**
 * Load the `natural` module synchronously from Node ESM.
 *
 * Returns `null` when the package is unavailable in the current runtime so
 * callers can degrade gracefully.
 */
export function getNaturalModule(): NaturalModule | null {
  if (cachedNaturalModule !== undefined) {
    return cachedNaturalModule;
  }

  try {
    const require = createRequire(import.meta.url);
    cachedNaturalModule = normalizeNaturalModule(require('natural'));
  } catch {
    cachedNaturalModule = null;
  }

  return cachedNaturalModule;
}
