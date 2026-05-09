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
  let safe = connStr;

  // URL form: postgresql://user:password@host/db
  // Use the URL parser so passwords containing '@' are handled correctly
  // (the regex approach split at the wrong '@' for passwords like
  // 'p@ss@word'). Falls back to the regex for non-URL inputs (keyword
  // form below) since `new URL` rejects them.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(connStr)) {
    try {
      const url = new URL(connStr);
      if (url.password) {
        url.password = '***';
        safe = url.toString();
      }
    } catch {
      // Malformed URL — skip URL path; the keyword regexes below are no-ops
      // for URLs and the original string passes through.
    }
  }

  // Quoted keyword form. Inner pattern admits doubled-quote (Postgres
  // libpq style) and backslash escapes inside quoted values so the
  // matcher doesn't terminate early on a literal escaped quote in the
  // password (e.g. password='a''b' or password='a\'b'), which would
  // otherwise leak the trailing fragment past the supposed closer.
  safe = safe.replace(
    /(password\s*=\s*)'(?:''|\\'|[^'])*'/gi,
    "$1'***'",
  );
  safe = safe.replace(
    /(password\s*=\s*)"(?:""|\\"|[^"])*"/gi,
    '$1"***"',
  );
  // Bare keyword form: password=token (whitespace- or end-terminated)
  safe = safe.replace(/(password\s*=\s*)[^\s'"]+/gi, '$1***');
  return safe;
}
