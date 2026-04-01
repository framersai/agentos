/**
 * @fileoverview Barrel exports for the Memory I/O subsystem.
 *
 * All importers and exporters for the AgentOS memory brain are re-exported
 * from this single entry point.
 *
 * **Exporters** — serialise a `SqliteBrain` to an external format:
 * - `JsonExporter`     — JSON file with optional base64-encoded embeddings.
 * - `MarkdownExporter` — directory of `.md` files with YAML front-matter.
 * - `ObsidianExporter` — Obsidian vault with `[[wikilinks]]` and `#tags`.
 * - `SqliteExporter`   — full-fidelity SQLite file copy via `VACUUM INTO`.
 *
 * **Importers** — merge external data into a `SqliteBrain`:
 * - `JsonImporter`     — parses a `JsonExporter` JSON file.
 * - `MarkdownImporter` — walks a directory of YAML front-matter Markdown files.
 * - `ObsidianImporter` — extends `MarkdownImporter` with wikilink → edge parsing.
 * - `SqliteImporter`   — merges another SQLite brain file (smart dedup + tag union).
 * - `ChatGptImporter`  — parses ChatGPT's `conversations.json` export format.
 * - `CsvImporter`      — imports flat CSV files with a required `content` column.
 *
 * @module memory/io
 */
export { JsonExporter } from './JsonExporter.js';
export { JsonImporter } from './JsonImporter.js';
export { MarkdownExporter } from './MarkdownExporter.js';
export { MarkdownImporter } from './MarkdownImporter.js';
export { ObsidianExporter } from './ObsidianExporter.js';
export { ObsidianImporter } from './ObsidianImporter.js';
// SqliteExporter and SqliteImporter require 'better-sqlite3' (native module).
// They are NOT re-exported from the barrel to avoid crashing when better-sqlite3
// is not installed. Import them directly when needed:
//   const { SqliteImporter } = await import('./memory/io/SqliteImporter.js');
//   const { SqliteExporter } = await import('./memory/io/SqliteExporter.js');
export { ChatGptImporter } from './ChatGptImporter.js';
export { CsvImporter } from './CsvImporter.js';
//# sourceMappingURL=index.js.map