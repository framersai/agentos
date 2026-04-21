/**
 * @file FactStore.ts
 * @description In-memory `(scope, scopeId, subjectHash, predicateHash) →
 * FactStoreEntry` map. Populated at session-ingest time by
 * `FactExtractor`; queried from `HybridRetriever` at query time.
 *
 * The store is per-case-scoped (no cross-run persistence in MVP); callers
 * that want persistent fact storage wire a SQLite-backed variant on top
 * of the same interface in a follow-up.
 *
 * @module agentos/memory/retrieval/fact-graph/FactStore
 */

import type { Fact, FactStoreEntry } from './types.js';
import {
  canonicalizeSubject,
  hashPredicate,
  hashSubject,
  isValidPredicate,
} from './canonicalization.js';

export class FactStore {
  private readonly map = new Map<string, FactStoreEntry>();

  private keyOf(
    scope: string,
    scopeId: string,
    subjectHash: string,
    predicateHash: string,
  ): string {
    return `${scope}|${scopeId}|${subjectHash}|${predicateHash}`;
  }

  /**
   * Insert facts. Facts with predicates outside the closed schema are
   * silently dropped (matches the `FactExtractor` contract). Subjects
   * are canonicalized; the stored form carries the canonical subject.
   * Per-(subject, predicate) entries stay time-sorted ascending so
   * {@link getLatest} is O(1) and {@link getAllTimeOrdered} is O(n).
   */
  upsert(scope: string, scopeId: string, facts: readonly Fact[]): void {
    for (const raw of facts) {
      if (!isValidPredicate(raw.predicate)) continue;
      const subject = canonicalizeSubject(raw.subject);
      const fact: Fact = { ...raw, subject };
      const key = this.keyOf(
        scope,
        scopeId,
        hashSubject(subject),
        hashPredicate(fact.predicate),
      );
      let entry = this.map.get(key);
      if (!entry) {
        entry = { facts: [] };
        this.map.set(key, entry);
      }
      entry.facts.push(fact);
      entry.facts.sort((a, b) => a.timestamp - b.timestamp);
    }
  }

  /**
   * Return the latest fact for (subject, predicate) or null. Supports
   * un-canonicalized subject input (canonicalized internally). Returns
   * null for predicates outside the closed schema.
   */
  getLatest(
    scope: string,
    scopeId: string,
    subject: string,
    predicate: string,
  ): Fact | null {
    if (!isValidPredicate(predicate)) return null;
    const canonicalSubject = canonicalizeSubject(subject);
    const key = this.keyOf(
      scope,
      scopeId,
      hashSubject(canonicalSubject),
      hashPredicate(predicate),
    );
    const entry = this.map.get(key);
    if (!entry || entry.facts.length === 0) return null;
    return entry.facts[entry.facts.length - 1]!;
  }

  /**
   * Return ALL facts for a subject (across predicates), time-sorted
   * ascending. Used for temporal queries where history matters.
   */
  getAllTimeOrdered(scope: string, scopeId: string, subject: string): Fact[] {
    const canonicalSubject = canonicalizeSubject(subject);
    const subjectHash = hashSubject(canonicalSubject);
    const prefix = `${scope}|${scopeId}|${subjectHash}|`;
    const out: Fact[] = [];
    for (const [k, entry] of this.map) {
      if (!k.startsWith(prefix)) continue;
      out.push(...entry.facts);
    }
    out.sort((a, b) => a.timestamp - b.timestamp);
    return out;
  }
}
