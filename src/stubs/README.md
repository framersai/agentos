# Type Stubs for Optional Native Dependencies

This directory contains minimal TypeScript type declarations (`.d.ts` files) for
packages that are **optional at runtime** but need type information at build time.

## Why stubs exist

AgentOS dynamically imports several heavy native packages inside `try/catch` blocks:

```typescript
// Runtime: only loads if the user has sharp installed
try {
  const sharpModule = await import('sharp');
  // ...use sharp...
} catch {
  // graceful fallback — sharp not installed
}
```

These packages are **not in `dependencies`** because:

- They're large native binaries (sharp ~30MB, hnswlib-node, tesseract.js, etc.)
- Most users only need a subset — a text-only agent doesn't need sharp
- They're declared as `peerDependencies` or not declared at all
- CI environments don't install optional peer deps

But **TypeScript still resolves types at compile time**, even for dynamic `import()`.
Without type info, `tsc` fails with `TS2307: Cannot find module`. The
`skipLibCheck: true` flag only skips type-checking *within* installed `.d.ts` files —
it doesn't help when the module is completely absent.

## What stubs provide

Each stub declares the **minimum type surface** that AgentOS actually uses. For example,
`sharp.d.ts` only declares the 6 methods called in `VideoAnalyzer.ts`, not sharp's
full 200+ method API.

This means:

- `tsc` compiles successfully without the actual package installed
- Runtime code still works — dynamic `import()` loads the real package if available
- CI builds pass without installing 100MB+ of optional native deps
- Type safety is maintained for the methods we actually call

## Alternatives considered

| Approach | Why not |
|---|---|
| `@types/*` as devDependency | Works for popular packages (sharp, pg) but not for niche ones (hnswlib-node, ppu-paddle-ocr). Inconsistent pattern. |
| Exclude files from `tsconfig.build.json` | Then those files get zero type checking — bugs slip through silently. |
| `// @ts-ignore` on every import | Suppresses all type checking for the imported value, not just the module resolution. |
| `declare module '*'` wildcard | Too broad — suppresses errors for genuinely missing modules too. |

## Adding a new stub

When you add a new optional native dependency:

1. Use dynamic `import()` with `try/catch` in the source code
2. Add the package to `peerDependencies` in `package.json` (with `"optional": true` in `peerDependenciesMeta`)
3. Create a `.d.ts` stub here with only the methods you actually call
4. The stub is auto-included via `tsconfig.build.json`'s `"include": ["src/stubs/**/*.ts"]`

## Current stubs

| Stub | Used by | Methods declared |
|---|---|---|
| `graphology.d.ts` | CapabilityGraph, knowledge graph | Graph constructor |
| `graphology-communities-louvain.d.ts` | CapabilityGraph | louvain() community detection |
| `hnswlib-node.d.ts` | HnswlibVectorStore | HierarchicalNSW class |
| `tesseract.d.ts` | MultimodalIndexer OCR | createWorker, Worker |
| `ppu-paddle-ocr.d.ts` | MultimodalIndexer OCR fallback | PaddleOCR class |
| `sharp.d.ts` | VideoAnalyzer frame decoding | removeAlpha, toColourspace, raw, toBuffer |
