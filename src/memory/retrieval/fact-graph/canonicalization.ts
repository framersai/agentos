/**
 * @file canonicalization.ts
 * @description Subject/predicate normalization + the closed 24-predicate
 * schema powering the Step 9 fact-graph. The closed schema is the core
 * design decision: it kills the Step 5/7/8 failure mode where general-
 * purpose LLMs emit useless catch-all predicates ("mentioned",
 * "discussed") that masked over-generalization. Extraction outputs
 * with predicates outside this set are silently dropped.
 *
 * @module agentos/memory/retrieval/fact-graph/canonicalization
 */

import { createHash } from 'node:crypto';

const FIRST_PERSON = new Set(['i', 'my', 'me', 'mine', 'myself']);

/**
 * The 25 canonical predicates Step 9 accepts. Grouped by category for
 * readability; the Set is flat at runtime. (The Step 9 spec labels this
 * "24-predicate schema" — the actual enumerated list is 25; the spec
 * label is a counting artifact, the predicate set itself is authoritative.)
 */
export const PREDICATE_SCHEMA = new Set<string>([
  // Preferences (3)
  'prefers',
  'dislikes',
  'avoids',
  // Identity (3)
  'is',
  'isNamed',
  'identifiesAs',
  // State (5)
  'livesIn',
  'worksAt',
  'studiesAt',
  'ownsPet',
  'drives',
  // Relationships (4)
  'marriedTo',
  'parentOf',
  'friendOf',
  'colleagueOf',
  // Events (4)
  'visited',
  'attended',
  'purchased',
  'scheduled',
  // Health (3)
  'allergicTo',
  'takesMedication',
  'diagnosedWith',
  // Misc (3) — deliberately narrow so the extractor can't fall back
  // to a generic "mentioned" catch-all.
  'commitsTo',
  'decidedOn',
  'believes',
]);

/**
 * Return the canonical form of a subject string.
 * - First-person pronouns (I, my, me, mine, myself) → "user"
 * - Anything else → lowercased + trimmed
 */
export function canonicalizeSubject(subject: string): string {
  const trimmed = subject.trim().toLowerCase();
  if (FIRST_PERSON.has(trimmed)) return 'user';
  return trimmed;
}

/** Whether `predicate` is in the closed schema. */
export function isValidPredicate(predicate: string): boolean {
  return PREDICATE_SCHEMA.has(predicate);
}

/** Stable 16-hex-char hash of a canonical subject. */
export function hashSubject(canonicalSubject: string): string {
  return createHash('sha256').update(`subj:${canonicalSubject}`).digest('hex').slice(0, 16);
}

/** Stable 16-hex-char hash of a predicate. */
export function hashPredicate(predicate: string): string {
  return createHash('sha256').update(`pred:${predicate}`).digest('hex').slice(0, 16);
}
