/**
 * @fileoverview Redact passwords from Postgres connection strings before
 * inclusion in error messages or logs. Handles both URL form and keyword form.
 *
 * @module memory/retrieval/store/postgresPasswordRedaction
 */

/**
 * Replace the password in a Postgres connection string with `***`. Handles:
 *
 * - URL form: `postgresql://user:secret@host/db` -> `postgresql://user:***@host/db`
 * - Keyword form: `host=localhost password=secret dbname=foo` ->
 *   `host=localhost password=*** dbname=foo`
 * - Quoted keyword form: `password='secret with space'` -> `password='***'`
 * - Connection strings without an embedded password pass through unchanged.
 */
export function redactPostgresPassword(connStr: string): string {
  // URL form: postgresql://user:password@host/db
  let safe = connStr.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1***$2');
  // Quoted keyword form: password='...' or password="..."
  safe = safe.replace(/(password\s*=\s*)'[^']*'/gi, "$1'***'");
  safe = safe.replace(/(password\s*=\s*)"[^"]*"/gi, '$1"***"');
  // Bare keyword form: password=token (whitespace- or end-terminated)
  safe = safe.replace(/(password\s*=\s*)[^\s'"]+/gi, '$1***');
  return safe;
}
