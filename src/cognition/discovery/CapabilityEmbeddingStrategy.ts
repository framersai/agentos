/**
 * @fileoverview Capability Embedding Strategy
 * @module @framers/agentos/discovery/CapabilityEmbeddingStrategy
 *
 * Constructs the embedding text for each capability descriptor.
 * The strategy captures WHEN a capability is useful (intent-oriented),
 * not just what it does (description-only).
 *
 * Design informed by:
 * - ToolLLM Neural API Retriever: embedding API docs (name, description, params)
 *   achieves NDCG@5 of 84.9 on 16K+ APIs
 * - MCP-RAG: decomposing tools into parameter-level embeddings improves matching
 * - Context Rot (Chroma 2025): keeping embedded text concise maximizes retrieval precision
 */

import type { CapabilityDescriptor } from './types.js';

// ============================================================================
// EMBEDDING STRATEGY
// ============================================================================

/**
 * Builds optimized embedding text for capability descriptors.
 *
 * The embedding text is structured to maximize semantic match with user intents:
 * 1. Name/display name — captures exact-match queries
 * 2. Description — core semantic content
 * 3. Category + tags — captures categorical queries ("communication tool")
 * 4. Parameter names — captures action queries ("I need to search for X")
 * 5. Dependencies — captures composition queries ("tool that works with GitHub")
 */
export class CapabilityEmbeddingStrategy {
  /**
   * Build the text that will be embedded for a capability.
   * Designed to be concise (typically 100-300 tokens) while capturing
   * the key semantic signals for retrieval.
   */
  buildEmbeddingText(cap: CapabilityDescriptor): string {
    const parts: string[] = [];

    // 1. Name and display name (captures exact-match queries)
    if (cap.displayName !== cap.name) {
      parts.push(`${cap.displayName} (${cap.name})`);
    } else {
      parts.push(cap.name);
    }

    // 2. Description (core semantics — the most important part)
    if (cap.description) {
      parts.push(cap.description);
    }

    // 3. Category (captures categorical queries like "I need a developer tool")
    if (cap.category) {
      parts.push(`Category: ${cap.category}`);
    }

    // 4. Tags (captures use-case queries like "search", "automation", "messaging")
    if (cap.tags.length > 0) {
      parts.push(`Use cases: ${cap.tags.join(', ')}`);
    }

    // 5. For tools: extract parameter names from schema
    //    This captures queries like "I need to specify a URL" → matches url param
    if (cap.kind === 'tool' && cap.fullSchema) {
      const paramNames = extractParameterNames(cap.fullSchema);
      if (paramNames.length > 0) {
        parts.push(`Parameters: ${paramNames.join(', ')}`);
      }
    }

    // 6. Dependencies (captures composition queries)
    if (cap.requiredTools.length > 0) {
      parts.push(`Requires: ${cap.requiredTools.join(', ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Build a compact summary text for Tier 1 display.
   * This is shown to the LLM when a capability is retrieved as relevant.
   * Kept to ~30-50 tokens per capability.
   */
  buildCompactSummary(cap: CapabilityDescriptor): string {
    const parts: string[] = [];

    // Name and kind
    parts.push(`${cap.name} (${cap.kind})`);

    // Truncated description
    const desc = cap.description.length > 120
      ? cap.description.slice(0, 117) + '...'
      : cap.description;
    parts.push(desc);

    // Key params for tools (top 3)
    if (cap.kind === 'tool' && cap.fullSchema) {
      const params = extractParameterNames(cap.fullSchema, 3);
      if (params.length > 0) {
        parts.push(`Params: ${params.join(', ')}`);
      }
    }

    // Dependencies
    if (cap.requiredTools.length > 0) {
      parts.push(`Requires: ${cap.requiredTools.join(', ')}`);
    }

    // Availability warning
    if (!cap.available) {
      parts.push('[not available — missing secrets or dependencies]');
    }

    return parts.join('. ');
  }

  /**
   * Build the full detail text for Tier 2 injection.
   * Includes full schema and/or SKILL.md content.
   */
  buildFullDetailText(cap: CapabilityDescriptor): string {
    const parts: string[] = [];

    parts.push(`# ${cap.displayName}`);
    parts.push(`Kind: ${cap.kind} | Category: ${cap.category}`);

    if (cap.description) {
      parts.push(`\n${cap.description}`);
    }

    // Full schema for tools
    if (cap.kind === 'tool' && cap.fullSchema) {
      parts.push('\n## Input Schema');
      parts.push(formatSchemaForContext(cap.fullSchema));
    }

    // Full SKILL.md content for skills
    if (cap.fullContent) {
      parts.push('\n## Skill Instructions');
      parts.push(cap.fullContent);
    }

    // Required secrets
    if (cap.requiredSecrets.length > 0) {
      parts.push(`\nRequired secrets: ${cap.requiredSecrets.join(', ')}`);
    }

    // Tags
    if (cap.tags.length > 0) {
      parts.push(`Tags: ${cap.tags.join(', ')}`);
    }

    return parts.join('\n');
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extract property names from a JSON Schema object.
 * Returns the top-level property names, optionally limited.
 */
function extractParameterNames(schema: Record<string, unknown>, limit?: number): string[] {
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (!properties) return [];

  const names = Object.keys(properties);
  return limit ? names.slice(0, limit) : names;
}

/**
 * Format a JSON Schema for context injection.
 * Produces a compact, human-readable representation.
 */
function formatSchemaForContext(schema: Record<string, unknown>): string {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) return '(no parameters)';

  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );

  const lines: string[] = [];
  for (const [name, prop] of Object.entries(properties)) {
    const type = prop.type ?? 'any';
    const isRequired = required.has(name);
    const desc = prop.description ? `: ${prop.description}` : '';
    const enumValues = Array.isArray(prop.enum) ? ` [${(prop.enum as string[]).join('|')}]` : '';
    const defaultVal = prop.default !== undefined ? ` (default: ${JSON.stringify(prop.default)})` : '';
    const reqLabel = isRequired ? ', required' : '';

    lines.push(`  ${name} (${type}${reqLabel})${desc}${enumValues}${defaultVal}`);
  }

  return lines.join('\n');
}
