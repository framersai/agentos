/**
 * @fileoverview Citation verification — claim decomposition + cosine similarity.
 * @module agentos/rag/citation
 */

export { CitationVerifier } from './CitationVerifier.js';
export { cosineSimilarity } from './cosine.js';
export { formatVerifiedResponse } from './format.js';
export type {
  CitationVerifierConfig,
  ClaimVerdict,
  VerifiedResponse,
  VerificationSource,
} from './types.js';
