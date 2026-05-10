/**
 * Citation Verification Example
 *
 * Demonstrates how to verify claims in text against sources
 * using cosine similarity with the CitationVerifier.
 *
 * Run: node examples/citation-verification.mjs
 * Requires: OPENAI_API_KEY (for embeddings)
 */

import { CitationVerifier, formatVerifiedResponse } from '@framers/agentos';

// --- Mock embedding function (replace with real embeddings in production) ---
function mockEmbed(texts) {
  return Promise.resolve(
    texts.map((t) => {
      const vec = new Array(64).fill(0);
      for (let i = 0; i < t.length; i++) vec[i % 64] += t.charCodeAt(i) / 1000;
      const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      return mag > 0 ? vec.map((v) => v / mag) : vec;
    }),
  );
}

// --- Create verifier ---
const verifier = new CitationVerifier({
  embedFn: mockEmbed,
  supportThreshold: 0.6,     // cosine >= 0.6 = supported
  unverifiableThreshold: 0.3, // cosine < 0.3 = unverifiable
});

// --- Verify claims against sources ---
// Three claims. One source per claim. The third claim has no source — it
// should come back as "unverifiable" so callers know to stop quoting it.
const result = await verifier.verify(
  'Tokyo is the capital of Japan. ' +
  'Tokyo proper has roughly 14 million residents. ' +
  'Tokyo hosted the 2020 Summer Olympics in 1457.',
  [
    {
      content: 'Tokyo is the capital and seat of government of Japan.',
      title: 'Japan Overview',
      url: 'https://example.com/japan',
    },
    {
      content: 'The population of Tokyo proper is approximately 14 million.',
      title: 'Tokyo Demographics',
      url: 'https://example.com/tokyo',
    },
  ],
);

// --- Print results ---
console.log('=== Citation Verification Results ===\n');
console.log(`Summary: ${formatVerifiedResponse(result)}`);
console.log(`Overall grounded: ${result.overallGrounded}`);
console.log(`Supported: ${result.supportedCount}/${result.totalClaims}`);
console.log(`Weak: ${result.weakCount}/${result.totalClaims}`);
console.log(`Unverifiable: ${result.unverifiableCount}/${result.totalClaims}`);
console.log();

for (const claim of result.claims) {
  const icon =
    claim.verdict === 'supported' ? '✓' :
    claim.verdict === 'weak' ? '~' :
    claim.verdict === 'contradicted' ? '✗' : '?';
  console.log(`  ${icon} [${claim.verdict}] (${(claim.confidence * 100).toFixed(0)}%) ${claim.text}`);
  if (claim.sourceSnippet) {
    console.log(`    └─ Source: ${claim.sourceSnippet.slice(0, 80)}...`);
  }
}
