/**
 * @fileoverview Capability Context Assembler — tiered, token-budgeted context builder.
 * @module @framers/agentos/discovery/CapabilityContextAssembler
 *
 * Assembles the capability discovery context for injection into agent prompts.
 * Enforces hard token budgets per tier to prevent context rot.
 *
 * Three tiers (inspired by Anthropic's defer_loading + Redis Tool RAG):
 *
 * Tier 0 (~150 tokens): Category summaries — always in context
 *   "Available categories: Information (4), Developer (3), Communication (8)..."
 *
 * Tier 1 (~200 tokens): Retrieved summaries — per-turn semantic retrieval
 *   "1. web-search (tool, 0.87): Search web. Params: query, max_results"
 *
 * Tier 2 (~1500 tokens): Full details — top-2 most relevant capabilities
 *   Full JSON schema or SKILL.md content
 *
 * Token budgets are hard-enforced by the assembler, NOT the LLM.
 * This is critical for preventing context rot (Chroma 2025).
 */

import type {
  CapabilityDescriptor,
  CapabilityDiscoveryConfig,
  CapabilityDiscoveryResult,
  CapabilitySearchResult,
  Tier1Result,
  Tier2Result,
  TokenEstimate,
} from './types.js';
import { DEFAULT_DISCOVERY_CONFIG } from './types.js';
import { CapabilityEmbeddingStrategy } from './CapabilityEmbeddingStrategy.js';

// ============================================================================
// CONTEXT ASSEMBLER
// ============================================================================

export class CapabilityContextAssembler {
  private readonly strategy: CapabilityEmbeddingStrategy;
  private cachedTier0: string | null = null;
  private cachedTier0Version = 0;

  constructor(strategy?: CapabilityEmbeddingStrategy) {
    this.strategy = strategy ?? new CapabilityEmbeddingStrategy();
  }

  // ============================================================================
  // TIER 0: CATEGORY SUMMARIES
  // ============================================================================

  /**
   * Build Tier 0 category summary text.
   * Regenerated only when capabilities change (tracked by version).
   */
  buildTier0(
    capabilities: CapabilityDescriptor[],
    version: number,
  ): string {
    if (this.cachedTier0 && this.cachedTier0Version === version) {
      return this.cachedTier0;
    }

    // Group by category
    const categories = new Map<string, { names: string[]; count: number }>();
    for (const cap of capabilities) {
      const cat = cap.category || 'other';
      const entry = categories.get(cat) ?? { names: [], count: 0 };
      entry.names.push(cap.name);
      entry.count++;
      categories.set(cat, entry);
    }

    // Sort categories by count descending
    const sorted = Array.from(categories.entries()).sort(
      (a, b) => b[1].count - a[1].count,
    );

    const lines: string[] = ['Available capability categories:'];
    for (const [category, { names, count }] of sorted) {
      // Show first 4 names, then count
      const displayNames = names.slice(0, 4).join(', ');
      const suffix = count > 4 ? ` (+${count - 4} more)` : '';
      lines.push(`- ${capitalize(category)}: ${displayNames}${suffix} (${count})`);
    }
    lines.push('Use discover_capabilities tool to get details on any capability.');

    const text = lines.join('\n');
    this.cachedTier0 = text;
    this.cachedTier0Version = version;
    return text;
  }

  // ============================================================================
  // ASSEMBLY
  // ============================================================================

  /**
   * Assemble discovery context from search results.
   *
   * Takes raw search results (already filtered and graph-reranked),
   * applies token budgets, and produces the final tiered result.
   */
  assemble(
    tier0Text: string,
    searchResults: CapabilitySearchResult[],
    config: CapabilityDiscoveryConfig = DEFAULT_DISCOVERY_CONFIG,
    timings?: { embeddingTimeMs: number; graphTraversalTimeMs: number },
  ): CapabilityDiscoveryResult {
    const startTime = performance.now();

    // --- Tier 0 ---
    const tier0Tokens = estimateTokens(tier0Text);

    // --- Tier 1: Build compact summaries within budget ---
    const tier1: Tier1Result[] = [];
    let tier1Tokens = 0;
    const tier1Header = 'Relevant capabilities:\n';
    tier1Tokens += estimateTokens(tier1Header);

    const tier1Candidates = searchResults
      .filter((r) => r.score >= config.tier1MinRelevance)
      .slice(0, config.tier1TopK);

    for (const candidate of tier1Candidates) {
      const summary = this.strategy.buildCompactSummary(candidate.descriptor);
      const lineText = `${tier1.length + 1}. ${summary}`;
      const lineTokens = estimateTokens(lineText);

      if (tier1Tokens + lineTokens > config.tier1TokenBudget) break;

      tier1Tokens += lineTokens;
      tier1.push({
        capability: candidate.descriptor,
        relevanceScore: candidate.score,
        summaryText: lineText,
      });
    }

    // --- Tier 2: Full details within budget ---
    const tier2: Tier2Result[] = [];
    let tier2Tokens = 0;

    // Take top N from Tier 1 for full expansion
    const tier2Candidates = tier1.slice(0, config.tier2TopK);

    for (const candidate of tier2Candidates) {
      const fullText = this.strategy.buildFullDetailText(candidate.capability);
      const fullTokens = estimateTokens(fullText);

      if (tier2Tokens + fullTokens > config.tier2TokenBudget) break;

      tier2Tokens += fullTokens;
      tier2.push({
        capability: candidate.capability,
        fullText,
      });
    }

    const totalTokens = tier0Tokens + tier1Tokens + tier2Tokens;
    const queryTimeMs = performance.now() - startTime;

    return {
      tier0: tier0Text,
      tier1,
      tier2,
      tokenEstimate: {
        tier0Tokens,
        tier1Tokens,
        tier2Tokens,
        totalTokens,
      },
      diagnostics: {
        queryTimeMs,
        embeddingTimeMs: timings?.embeddingTimeMs ?? 0,
        graphTraversalTimeMs: timings?.graphTraversalTimeMs ?? 0,
        candidatesScanned: searchResults.length,
        capabilitiesRetrieved: tier1.length + tier2.length,
      },
    };
  }

  /**
   * Render a CapabilityDiscoveryResult into a single string
   * suitable for injection into PromptBuilder.
   */
  renderForPrompt(result: CapabilityDiscoveryResult): string {
    const parts: string[] = [];

    // Tier 0: Always present
    parts.push(result.tier0);

    // Tier 1: Retrieved summaries
    if (result.tier1.length > 0) {
      parts.push('');
      parts.push('Relevant capabilities:');
      for (const item of result.tier1) {
        parts.push(item.summaryText);
      }
    }

    // Tier 2: Full details
    if (result.tier2.length > 0) {
      parts.push('');
      parts.push('--- Detailed Capability Reference ---');
      for (const item of result.tier2) {
        parts.push('');
        parts.push(item.fullText);
      }
    }

    return parts.join('\n');
  }

  /**
   * Invalidate the Tier 0 cache (e.g., after capabilities change).
   */
  invalidateCache(): void {
    this.cachedTier0 = null;
    this.cachedTier0Version = 0;
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Rough token estimation (~4 chars per token for English text).
 * Used for budget enforcement — not exact, but close enough for budgeting.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Capitalize the first letter of a string.
 */
function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
