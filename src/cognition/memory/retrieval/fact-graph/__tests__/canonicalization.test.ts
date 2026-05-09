import { describe, it, expect } from 'vitest';
import {
  canonicalizeSubject,
  hashSubject,
  hashPredicate,
  isValidPredicate,
  PREDICATE_SCHEMA,
} from '../canonicalization.js';

describe('canonicalizeSubject', () => {
  it('maps first-person pronouns to "user"', () => {
    expect(canonicalizeSubject('I')).toBe('user');
    expect(canonicalizeSubject('my')).toBe('user');
    expect(canonicalizeSubject('me')).toBe('user');
    expect(canonicalizeSubject('mine')).toBe('user');
    expect(canonicalizeSubject('MYSELF')).toBe('user');
  });

  it('lowercases + trims other subjects', () => {
    expect(canonicalizeSubject('  Alice  ')).toBe('alice');
    expect(canonicalizeSubject('Acme Corp')).toBe('acme corp');
  });
});

describe('hashSubject + hashPredicate', () => {
  it('produces stable 16-hex-char hashes', () => {
    const h1 = hashSubject('user');
    const h2 = hashSubject('user');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
    expect(hashPredicate('livesIn')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differentiates different inputs', () => {
    expect(hashSubject('user')).not.toBe(hashSubject('alice'));
    expect(hashPredicate('livesIn')).not.toBe(hashPredicate('worksAt'));
  });

  it('uses namespace prefix so subject and predicate hashes do not collide for same input', () => {
    expect(hashSubject('foo')).not.toBe(hashPredicate('foo'));
  });
});

describe('PREDICATE_SCHEMA + isValidPredicate', () => {
  it('has the full canonical predicate set', () => {
    // Spec labels "24-predicate schema" but actually enumerates 25;
    // the enumerated list is authoritative.
    expect(PREDICATE_SCHEMA.size).toBe(25);
  });

  it('covers core LongMemEval categories', () => {
    for (const p of [
      'prefers',
      'dislikes',
      'livesIn',
      'worksAt',
      'marriedTo',
      'parentOf',
      'allergicTo',
      'diagnosedWith',
      'commitsTo',
      'decidedOn',
    ]) {
      expect(PREDICATE_SCHEMA.has(p)).toBe(true);
    }
  });

  it('rejects predicates outside the schema', () => {
    expect(isValidPredicate('prefers')).toBe(true);
    expect(isValidPredicate('mentioned')).toBe(false);
    expect(isValidPredicate('discussed')).toBe(false);
    expect(isValidPredicate('')).toBe(false);
  });
});
