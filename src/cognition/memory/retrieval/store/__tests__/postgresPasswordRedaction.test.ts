/**
 * @fileoverview Unit tests for redactPostgresPassword. Covers URL form,
 * keyword form (bare and quoted), and pass-through cases.
 *
 * @module memory/retrieval/store/__tests__/postgresPasswordRedaction.test
 */

import { describe, it, expect } from 'vitest';
import { redactPostgresPassword } from '../postgresPasswordRedaction.js';

describe('redactPostgresPassword', () => {
  it('redacts password in URL form', () => {
    expect(redactPostgresPassword('postgresql://user:secret@host/db')).toBe(
      'postgresql://user:***@host/db',
    );
  });

  it('redacts password in URL form with port and query string', () => {
    expect(
      redactPostgresPassword('postgres://alice:hunter2@db.example.com:5432/prod?sslmode=require'),
    ).toBe('postgres://alice:***@db.example.com:5432/prod?sslmode=require');
  });

  it('redacts bare keyword-form password', () => {
    expect(
      redactPostgresPassword('host=localhost password=secret dbname=foo'),
    ).toBe('host=localhost password=*** dbname=foo');
  });

  it('redacts keyword-form password at end of string', () => {
    expect(redactPostgresPassword('host=localhost dbname=foo password=secret')).toBe(
      'host=localhost dbname=foo password=***',
    );
  });

  it('redacts single-quoted keyword-form password', () => {
    expect(
      redactPostgresPassword("host=localhost password='se cret with space' dbname=foo"),
    ).toBe("host=localhost password='***' dbname=foo");
  });

  it('redacts double-quoted keyword-form password', () => {
    expect(
      redactPostgresPassword('host=localhost password="se cret with space" dbname=foo'),
    ).toBe('host=localhost password="***" dbname=foo');
  });

  it('handles password= with spaces around equals', () => {
    expect(redactPostgresPassword('password = secret host=localhost')).toBe(
      'password = *** host=localhost',
    );
  });

  it('passes through connection string with no password', () => {
    expect(redactPostgresPassword('postgresql://user@host/db')).toBe(
      'postgresql://user@host/db',
    );
    expect(redactPostgresPassword('host=localhost dbname=foo')).toBe(
      'host=localhost dbname=foo',
    );
  });

  it('redacts both URL-form password and keyword-form parameters in the same string', () => {
    // Edge case: hybrid form (rare but possible if a tool concatenates them)
    expect(
      redactPostgresPassword('postgresql://u:secret1@h/d?password=secret2'),
    ).toBe('postgresql://u:***@h/d?password=***');
  });

  it('is case-insensitive for the keyword PASSWORD', () => {
    expect(redactPostgresPassword('host=localhost PASSWORD=secret')).toBe(
      'host=localhost PASSWORD=***',
    );
  });
});
