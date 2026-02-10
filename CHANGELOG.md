## <small>0.1.22 (2026-02-10)</small>

* feat: expand README, fix schema-on-demand pack, update ecosystem docs ([d2d6b26](https://github.com/framersai/agentos/commit/d2d6b26))
* docs: add folder-level permissions & safe guardrails to docs ([97ec2f0](https://github.com/framersai/agentos/commit/97ec2f0))
* docs(releasing): align docs with conservative 0.x rules ([ebeb8e6](https://github.com/framersai/agentos/commit/ebeb8e6))

## <small>0.1.21 (2026-02-09)</small>

* feat(rag): add HNSW persistence + multimodal guide ([9a45d84](https://github.com/framersai/agentos/commit/9a45d84))
* docs: document GraphRAG updates + deletions ([a9b7f56](https://github.com/framersai/agentos/commit/a9b7f56))
* docs: update skills references to consolidated registry package ([7d344f3](https://github.com/framersai/agentos/commit/7d344f3))
* test: relax fetch mock typing ([b8647a2](https://github.com/framersai/agentos/commit/b8647a2))

## <small>0.1.20 (2026-02-08)</small>

* fix: add explicit exports for rag/reranking, rag/graphrag, core/hitl ([d90340d](https://github.com/framersai/agentos/commit/d90340d))
* feat(graphrag): support document removal ([cca2f52](https://github.com/framersai/agentos/commit/cca2f52))

## <small>0.1.19 (2026-02-08)</small>

* fix: add ./rag and ./config/* exports to package.json ([27dba19](https://github.com/framersai/agentos/commit/27dba19))

## <small>0.1.18 (2026-02-08)</small>

* feat(graphrag): re-ingest updates ([13700b8](https://github.com/framersai/agentos/commit/13700b8))
* docs: update README with safety primitives details ([496b172](https://github.com/framersai/agentos/commit/496b172))
* agentos: tool calling + safety + observability ([00b9187](https://github.com/framersai/agentos/commit/00b9187))

## <small>0.1.17 (2026-02-08)</small>

* feat: safety primitives — GuardedToolResult rename, tests & docs ([3ca722d](https://github.com/framersai/agentos/commit/3ca722d))

## <small>0.1.16 (2026-02-08)</small>

* fix: remove all 47 stale .d.ts files from src/ that duplicate .ts sources ([bdf3a56](https://github.com/framersai/agentos/commit/bdf3a56))
* fix: remove stale .d.ts files from src/core/tools/ ([6c9e307](https://github.com/framersai/agentos/commit/6c9e307))
* fix: use explicit type exports for ITool to avoid TS2308 ambiguity ([e506d79](https://github.com/framersai/agentos/commit/e506d79))
* docs: rewrite README with accurate API examples and streamlined structure ([d7e5157](https://github.com/framersai/agentos/commit/d7e5157))
* feat: Qdrant vector store, content safety service, otel improvements ([dbd7cb2](https://github.com/framersai/agentos/commit/dbd7cb2))

## <small>0.1.15 (2026-02-08)</small>

* fix: update skills count from 16+ to 18 ([a50185e](https://github.com/framersai/agentos/commit/a50185e))

## <small>0.1.14 (2026-02-08)</small>

* fix: provide fallback for optional personaId in pushErrorChunk call ([d779a7e](https://github.com/framersai/agentos/commit/d779a7e))
* feat: enhanced RAG pipeline, observability, schema-on-demand extension ([b6e98e4](https://github.com/framersai/agentos/commit/b6e98e4))

## <small>0.1.13 (2026-02-07)</small>

* feat: add AutonomyGuard + PolicyProfiles tests, skills ecosystem improvements ([36a99eb](https://github.com/framersai/agentos/commit/36a99eb))

## <small>0.1.12 (2026-02-07)</small>

* feat: add 7 P3 channel platforms for OpenClaw parity ([5a988ce](https://github.com/framersai/agentos/commit/5a988ce))

## <small>0.1.11 (2026-02-07)</small>

* feat: append-only persistence, skills system, provenance hooks ([73f9afb](https://github.com/framersai/agentos/commit/73f9afb))

## <small>0.1.10 (2026-02-07)</small>

* fix: remove marketing copy from architecture docs ([6feb377](https://github.com/framersai/agentos/commit/6feb377))

## <small>0.1.9 (2026-02-07)</small>

* fix: make ExtensionPackContext fields optional, add logger/getSecret ([991ca25](https://github.com/framersai/agentos/commit/991ca25))

## <small>0.1.8 (2026-02-07)</small>

* fix: add ExtensionPack onActivate/onDeactivate union type for backwards compat ([c8c64e9](https://github.com/framersai/agentos/commit/c8c64e9))
* docs: add extensions-registry package to ecosystem guide ([eeb0b6a](https://github.com/framersai/agentos/commit/eeb0b6a))

## <small>0.1.7 (2026-02-07)</small>

* feat: channel system, extension secrets, messaging types, docs ([63487ed](https://github.com/framersai/agentos/commit/63487ed))

## <small>0.1.6 (2026-02-06)</small>

* refactor: rename extension packages to @framers/agentos-ext-* convention ([233e9a4](https://github.com/framersai/agentos/commit/233e9a4))
* refactor: rename extension packages to @framers/agentos-ext-* convention ([a6e40ac](https://github.com/framersai/agentos/commit/a6e40ac))
* refactor: rename extension packages to @framers/agentos-ext-* convention ([64b03b7](https://github.com/framersai/agentos/commit/64b03b7))

## <small>0.1.5 (2026-02-05)</small>

* fix(tests): resolve test failures with proper mocks ([ce8e2bf](https://github.com/framersai/agentos/commit/ce8e2bf))
* docs: fix sidebar links for markdown pages ([451ab8c](https://github.com/framersai/agentos/commit/451ab8c))
* docs: update sidebar links to point to .html instead of .md ([d11c2ce](https://github.com/framersai/agentos/commit/d11c2ce))
* ci(docs): ship changelog + markdown pages ([be2a7bd](https://github.com/framersai/agentos/commit/be2a7bd))

## <small>0.1.4 (2026-01-25)</small>

* test(api): cover generator return final response ([758df4b](https://github.com/framersai/agentos/commit/758df4b))
* fix(api): use generator return value for final response ([0f46ab8](https://github.com/framersai/agentos/commit/0f46ab8))
* chore: add docs/api and coverage to .gitignore, fix path reference ([ef94f7a](https://github.com/framersai/agentos/commit/ef94f7a))

## <small>0.1.2 (2025-12-17)</small>

* docs: add comprehensive GUARDRAILS_USAGE.md ([a42d91d](https://github.com/framersai/agentos/commit/a42d91d))
* docs: add guardrail examples and link to usage guide ([b955fd1](https://github.com/framersai/agentos/commit/b955fd1))
* docs: add TypeDoc API documentation for v0.1.3 ([74cdb3c](https://github.com/framersai/agentos/commit/74cdb3c))
* docs: cleanup docs/README.md links ([a4e90fc](https://github.com/framersai/agentos/commit/a4e90fc))
* docs: expand AGENT_COMMUNICATION.md with implementation details [skip release] ([6033bdd](https://github.com/framersai/agentos/commit/6033bdd))
* docs: expand PLANNING_ENGINE.md with implementation details ([ee98839](https://github.com/framersai/agentos/commit/ee98839))
* docs: remove MIGRATION_TO_STORAGE_ADAPTER.md ([430c92a](https://github.com/framersai/agentos/commit/430c92a))
* docs: remove redundant AGENTOS_ARCHITECTURE_DEEP_DIVE.md ([b4e0fe2](https://github.com/framersai/agentos/commit/b4e0fe2))
* docs: update README with guardrails link and cleanup ([a322f4b](https://github.com/framersai/agentos/commit/a322f4b))
* docs(guardrails): add TSDoc to guardrailDispatcher ([de0557d](https://github.com/framersai/agentos/commit/de0557d))
* docs(guardrails): add TSDoc to IGuardrailService ([e973302](https://github.com/framersai/agentos/commit/e973302))
* fix: add EXTENSION_SECRET_DEFINITIONS export and fix atlas persona ([692e596](https://github.com/framersai/agentos/commit/692e596))
* fix: add NODE_AUTH_TOKEN for npm auth compatibility ([afe7b96](https://github.com/framersai/agentos/commit/afe7b96))
* fix: atlas persona schema and add orchestrator tests ([10533e0](https://github.com/framersai/agentos/commit/10533e0))
* fix: enable automatic semantic-release and expand docs links ([86e204d](https://github.com/framersai/agentos/commit/86e204d))
* fix: improve test coverage for model selection options propagation ([1d86154](https://github.com/framersai/agentos/commit/1d86154))
* fix: reset version to 0.1.3 from incorrect 1.0.3 [skip ci] ([62697cc](https://github.com/framersai/agentos/commit/62697cc))
* fix: trigger release with improved model options test coverage ([18820fc](https://github.com/framersai/agentos/commit/18820fc)), closes [#1](https://github.com/framersai/agentos/issues/1)
* fix: trigger release with updated npm token ([332395f](https://github.com/framersai/agentos/commit/332395f))
* fix: trigger semantic-release with v0.1.1 tag baseline ([0a5733f](https://github.com/framersai/agentos/commit/0a5733f))
* fix(orchestration): Correctly propagate model selection options to GMI ([4342283](https://github.com/framersai/agentos/commit/4342283))
* chore: trigger CI/CD for test coverage ([dae6b3f](https://github.com/framersai/agentos/commit/dae6b3f))
* chore: trigger docs rebuild ([0e5655f](https://github.com/framersai/agentos/commit/0e5655f))
* chore(release): 1.0.0 [skip ci] ([14ea3c3](https://github.com/framersai/agentos/commit/14ea3c3))
* chore(release): 1.0.1 [skip ci] ([4daf1ff](https://github.com/framersai/agentos/commit/4daf1ff))
* chore(release): 1.0.2 [skip ci] ([3054903](https://github.com/framersai/agentos/commit/3054903))
* chore(release): 1.0.3 [skip ci] ([5cd684c](https://github.com/framersai/agentos/commit/5cd684c))
* ci: disable semantic-release workflow ([4c44a1b](https://github.com/framersai/agentos/commit/4c44a1b))
* ci: re-enable semantic-release workflow ([3dac31a](https://github.com/framersai/agentos/commit/3dac31a))
* test: add AgentOrchestrator unit tests ([77fb28d](https://github.com/framersai/agentos/commit/77fb28d))
* test: add cross-agent guardrails tests ([2a93c7f](https://github.com/framersai/agentos/commit/2a93c7f))
* test: add tests for model selection options propagation in API AgentOSOrchestrator [skip release] ([5960167](https://github.com/framersai/agentos/commit/5960167))
* Merge pull request #1 from Victor-Evogor/master ([99eeafa](https://github.com/framersai/agentos/commit/99eeafa)), closes [#1](https://github.com/framersai/agentos/issues/1)
* feat(guardrails): add crossAgentGuardrailDispatcher ([20fdf57](https://github.com/framersai/agentos/commit/20fdf57))
* feat(guardrails): add guardrails module exports ([83480a6](https://github.com/framersai/agentos/commit/83480a6))
* feat(guardrails): add ICrossAgentGuardrailService interface ([f4a19c0](https://github.com/framersai/agentos/commit/f4a19c0))
* revert: set version back to 0.1.1 (1.0.1 was premature) ([e5af05f](https://github.com/framersai/agentos/commit/e5af05f))

## <small>0.1.3 (2025-12-15)</small>

* fix: atlas persona schema and add orchestrator tests ([10533e0](https://github.com/framersai/agentos/commit/10533e0))
* fix: improve test coverage for model selection options propagation ([1d86154](https://github.com/framersai/agentos/commit/1d86154))
* fix: trigger release with improved model options test coverage ([18820fc](https://github.com/framersai/agentos/commit/18820fc)), closes [#1](https://github.com/framersai/agentos/issues/1)
* fix(orchestration): Correctly propagate model selection options to GMI ([4342283](https://github.com/framersai/agentos/commit/4342283))
* ci: disable semantic-release workflow ([4c44a1b](https://github.com/framersai/agentos/commit/4c44a1b))
* ci: re-enable semantic-release workflow ([3dac31a](https://github.com/framersai/agentos/commit/3dac31a))
* chore: trigger CI/CD for test coverage ([dae6b3f](https://github.com/framersai/agentos/commit/dae6b3f))
* test: add cross-agent guardrails tests ([2a93c7f](https://github.com/framersai/agentos/commit/2a93c7f))
* test: add tests for model selection options propagation in API AgentOSOrchestrator [skip release] ([5960167](https://github.com/framersai/agentos/commit/5960167))
* Merge pull request #1 from Victor-Evogor/master ([99eeafa](https://github.com/framersai/agentos/commit/99eeafa)), closes [#1](https://github.com/framersai/agentos/issues/1)
* docs: add comprehensive GUARDRAILS_USAGE.md ([a42d91d](https://github.com/framersai/agentos/commit/a42d91d))
* docs: add guardrail examples and link to usage guide ([b955fd1](https://github.com/framersai/agentos/commit/b955fd1))
* docs: cleanup docs/README.md links ([a4e90fc](https://github.com/framersai/agentos/commit/a4e90fc))
* docs: expand AGENT_COMMUNICATION.md with implementation details [skip release] ([6033bdd](https://github.com/framersai/agentos/commit/6033bdd))
* docs: expand PLANNING_ENGINE.md with implementation details ([ee98839](https://github.com/framersai/agentos/commit/ee98839))
* docs: remove MIGRATION_TO_STORAGE_ADAPTER.md ([430c92a](https://github.com/framersai/agentos/commit/430c92a))
* docs: remove redundant AGENTOS_ARCHITECTURE_DEEP_DIVE.md ([b4e0fe2](https://github.com/framersai/agentos/commit/b4e0fe2))
* docs: update README with guardrails link and cleanup ([a322f4b](https://github.com/framersai/agentos/commit/a322f4b))
* docs(guardrails): add TSDoc to guardrailDispatcher ([de0557d](https://github.com/framersai/agentos/commit/de0557d))
* docs(guardrails): add TSDoc to IGuardrailService ([e973302](https://github.com/framersai/agentos/commit/e973302))
* feat(guardrails): add crossAgentGuardrailDispatcher ([20fdf57](https://github.com/framersai/agentos/commit/20fdf57))
* feat(guardrails): add guardrails module exports ([83480a6](https://github.com/framersai/agentos/commit/83480a6))
* feat(guardrails): add ICrossAgentGuardrailService interface ([f4a19c0](https://github.com/framersai/agentos/commit/f4a19c0))

## <small>0.1.2 (2025-12-13)</small>

* fix: add EXTENSION_SECRET_DEFINITIONS export and fix atlas persona ([692e596](https://github.com/framersai/agentos/commit/692e596))
* fix: add missing pino dependency ([0f4afdc](https://github.com/framersai/agentos/commit/0f4afdc))
* fix: add NODE_AUTH_TOKEN for npm auth compatibility ([afe7b96](https://github.com/framersai/agentos/commit/afe7b96))
* fix: align AgencyMemoryManager with IVectorStore interface ([3ea6131](https://github.com/framersai/agentos/commit/3ea6131))
* fix: clean up CodeSandbox lint issues ([76ff4c3](https://github.com/framersai/agentos/commit/76ff4c3))
* fix: clean up unused imports and params in AgentOrchestrator ([ac32855](https://github.com/framersai/agentos/commit/ac32855))
* fix: clean up unused variables in extension loaders ([d660b03](https://github.com/framersai/agentos/commit/d660b03))
* fix: correct IVectorStoreManager import path and add type annotation ([487f5b5](https://github.com/framersai/agentos/commit/487f5b5))
* fix: enable automatic semantic-release and expand docs links ([86e204d](https://github.com/framersai/agentos/commit/86e204d))
* fix: guard stream responses to satisfy ts ([1d2e4f7](https://github.com/framersai/agentos/commit/1d2e4f7))
* fix: ignore pushes to closed streams ([3c70fa2](https://github.com/framersai/agentos/commit/3c70fa2))
* fix: import MetadataValue from IVectorStore to resolve type conflict ([2f90071](https://github.com/framersai/agentos/commit/2f90071))
* fix: make sql-storage-adapter optional peer dep for standalone repo ([4be6628](https://github.com/framersai/agentos/commit/4be6628))
* fix: remove unused imports and variables from LLM providers ([f21759d](https://github.com/framersai/agentos/commit/f21759d))
* fix: remove unused imports from ModelRouter ([ea2baa5](https://github.com/framersai/agentos/commit/ea2baa5))
* fix: remove unused imports from PlanningEngine ([283c42f](https://github.com/framersai/agentos/commit/283c42f))
* fix: remove unused imports from storage and RAG modules ([36c2b3f](https://github.com/framersai/agentos/commit/36c2b3f))
* fix: rename unused options param in Marketplace ([2071869](https://github.com/framersai/agentos/commit/2071869))
* fix: resolve all ESLint errors and warnings ([093ab03](https://github.com/framersai/agentos/commit/093ab03))
* fix: resolve all TypeScript build errors and update tests for new API patterns ([6b34237](https://github.com/framersai/agentos/commit/6b34237))
* fix: resolve critical parsing error in MemoryLifecycleManager ([c5c1fb6](https://github.com/framersai/agentos/commit/c5c1fb6))
* fix: resolve iterator type errors in streaming batcher ([1048fd1](https://github.com/framersai/agentos/commit/1048fd1))
* fix: resolve TypeScript errors in tests and config ([f34ea5e](https://github.com/framersai/agentos/commit/f34ea5e))
* fix: restore RetrievalAugmentor and ToolPermissionManager formatting ([f4e881a](https://github.com/framersai/agentos/commit/f4e881a))
* fix: restore variables that were incorrectly marked as unused ([5282d39](https://github.com/framersai/agentos/commit/5282d39))
* fix: set version to 0.1.0 for initial release ([e980895](https://github.com/framersai/agentos/commit/e980895))
* fix: trigger release with updated npm token ([332395f](https://github.com/framersai/agentos/commit/332395f))
* fix: type cast checkHealth to avoid TS error ([8683217](https://github.com/framersai/agentos/commit/8683217))
* fix: unignore eslint.config.js in gitignore ([9c82ab1](https://github.com/framersai/agentos/commit/9c82ab1))
* fix: update AgencyMemoryManager tests to match implementation ([853d16f](https://github.com/framersai/agentos/commit/853d16f))
* fix: update Frame.dev logo to use SVG version ([128001f](https://github.com/framersai/agentos/commit/128001f))
* fix: use workspace:* for sql-storage-adapter dependency ([2d3a88a](https://github.com/framersai/agentos/commit/2d3a88a))
* fix(agentos): use import attributes with { type: 'json' } for Node 20+ ([9e95660](https://github.com/framersai/agentos/commit/9e95660))
* fix(build): decouple tsconfig from root to fix CI path resolution ([dd14c6a](https://github.com/framersai/agentos/commit/dd14c6a))
* fix(build): include JSON; exclude tests; add getConversation/listContexts; safe casts ([86e4610](https://github.com/framersai/agentos/commit/86e4610))
* fix(build): inline tsconfig base to support standalone build ([161f5a0](https://github.com/framersai/agentos/commit/161f5a0))
* fix(build): resolve tsconfig inheritance paths ([c2bd9e7](https://github.com/framersai/agentos/commit/c2bd9e7))
* fix(ci): add pnpm version to release workflow ([9b64eca](https://github.com/framersai/agentos/commit/9b64eca))
* fix(ci): include docs workflow in path triggers ([d67005f](https://github.com/framersai/agentos/commit/d67005f))
* fix(ci): remove frozen-lockfile from docs workflow ([fbb33b0](https://github.com/framersai/agentos/commit/fbb33b0))
* fix(ci): remove pnpm cache requirement from release workflow ([d1c90ef](https://github.com/framersai/agentos/commit/d1c90ef))
* fix(esm): make AgentOS dist Node ESM compatible ([783b0e9](https://github.com/framersai/agentos/commit/783b0e9))
* fix(guardrails): add type guard for evaluateOutput to satisfy TS ([0381ca6](https://github.com/framersai/agentos/commit/0381ca6))
* fix(guardrails): avoid undefined in streaming eval; add loadPackFromFactory ([e2c4d6d](https://github.com/framersai/agentos/commit/e2c4d6d))
* fix(hitl): remove unused imports in HITL module ([3d5e67f](https://github.com/framersai/agentos/commit/3d5e67f))
* test: add AgentOrchestrator unit tests ([77fb28d](https://github.com/framersai/agentos/commit/77fb28d))
* test: add comprehensive tests for workflows, extensions, and config - coverage ~67% ([672ac31](https://github.com/framersai/agentos/commit/672ac31))
* test: add logging tests and configure coverage thresholds ([511237e](https://github.com/framersai/agentos/commit/511237e))
* test: add tests for EmbeddingManager, uuid and error utilities ([979b3e2](https://github.com/framersai/agentos/commit/979b3e2))
* test: add ToolExecutor coverage ([6cb2b8c](https://github.com/framersai/agentos/commit/6cb2b8c))
* test: fix flaky timestamp ordering test in Evaluator ([56b560d](https://github.com/framersai/agentos/commit/56b560d))
* test(integration): add marketplace-evaluation integration tests ([035c646](https://github.com/framersai/agentos/commit/035c646))
* ci: add CI, release, and typedoc Pages workflows ([f3abfea](https://github.com/framersai/agentos/commit/f3abfea))
* ci: add CNAME for docs.agentos.sh custom domain ([11229ce](https://github.com/framersai/agentos/commit/11229ce))
* ci: add codecov coverage reporting and badge ([18b8224](https://github.com/framersai/agentos/commit/18b8224))
* ci: add coverage badge and CI workflow, update README ([3824c78](https://github.com/framersai/agentos/commit/3824c78))
* ci: add docs auto-deployment to agentos-live-docs branch ([e445b15](https://github.com/framersai/agentos/commit/e445b15))
* ci: add NODE_AUTH_TOKEN for npm publish ([4dec42f](https://github.com/framersai/agentos/commit/4dec42f))
* ci: add npm token debug step ([32a65c3](https://github.com/framersai/agentos/commit/32a65c3))
* ci: coverage badge ([12ce466](https://github.com/framersai/agentos/commit/12ce466))
* ci: enforce lint and typecheck quality gates ([8d51aff](https://github.com/framersai/agentos/commit/8d51aff))
* ci: manual releases, pnpm CI, add RELEASING.md ([0ee6fb6](https://github.com/framersai/agentos/commit/0ee6fb6))
* ci: replace semantic-release with direct npm publish ([b3a7072](https://github.com/framersai/agentos/commit/b3a7072))
* chore: add ESLint v9 flat config dependencies ([75556b7](https://github.com/framersai/agentos/commit/75556b7))
* chore: add release workflow (semantic-release) on master ([811a718](https://github.com/framersai/agentos/commit/811a718))
* chore: bootstrap repo (license, CI, docs templates) ([5965a4e](https://github.com/framersai/agentos/commit/5965a4e))
* chore: exclude config files from codecov coverage ([8dae2e3](https://github.com/framersai/agentos/commit/8dae2e3))
* chore: fix lint findings ([a60b3dd](https://github.com/framersai/agentos/commit/a60b3dd))
* chore: fix lint findings ([f55c22b](https://github.com/framersai/agentos/commit/f55c22b))
* chore: fix negotiation test types ([4f6da15](https://github.com/framersai/agentos/commit/4f6da15))
* chore: include release config and dev deps ([7b8e6c1](https://github.com/framersai/agentos/commit/7b8e6c1))
* chore: initial import from monorepo ([b75cd7a](https://github.com/framersai/agentos/commit/b75cd7a))
* chore: normalize file endings ([9e9a534](https://github.com/framersai/agentos/commit/9e9a534))
* chore: pin sql-storage-adapter to ^0.4.0 ([cec73d8](https://github.com/framersai/agentos/commit/cec73d8))
* chore: remove internal investigation docs ([12f7725](https://github.com/framersai/agentos/commit/12f7725))
* chore: silence unused vars in negotiation test ([16ec2bf](https://github.com/framersai/agentos/commit/16ec2bf))
* chore: sync agentos ([08a25e1](https://github.com/framersai/agentos/commit/08a25e1))
* chore: sync agentos configs ([18c46b6](https://github.com/framersai/agentos/commit/18c46b6))
* chore: sync changes ([0f67907](https://github.com/framersai/agentos/commit/0f67907))
* chore: trigger ci ([8abf707](https://github.com/framersai/agentos/commit/8abf707))
* chore: trigger release ([c0c7a1e](https://github.com/framersai/agentos/commit/c0c7a1e))
* chore: trigger release ([189e9ba](https://github.com/framersai/agentos/commit/189e9ba))
* chore: trigger release build ([9b1b59e](https://github.com/framersai/agentos/commit/9b1b59e))
* chore: trigger release build with codecov fix ([174bec9](https://github.com/framersai/agentos/commit/174bec9))
* chore: trigger v0.1.0 release ([990efbb](https://github.com/framersai/agentos/commit/990efbb))
* chore: type mock negotiation test ([230b6e7](https://github.com/framersai/agentos/commit/230b6e7))
* chore: use latest @framers/sql-storage-adapter ([e9fb6a9](https://github.com/framersai/agentos/commit/e9fb6a9))
* chore(build): fail agentos dist on TS errors ([f7670f0](https://github.com/framersai/agentos/commit/f7670f0))
* chore(extensions): export multi-registry types and loaders ([8ddc2d7](https://github.com/framersai/agentos/commit/8ddc2d7))
* chore(npm): rename package to @framers/agentos; add alias; update config ([f4875b1](https://github.com/framersai/agentos/commit/f4875b1))
* chore(release): 1.0.0 [skip ci] ([a2d74f2](https://github.com/framersai/agentos/commit/a2d74f2))
* docs: add architecture deep dive and recursive self-building analysis ([ce2982b](https://github.com/framersai/agentos/commit/ce2982b))
* docs: add changelog, typedoc config, docs index, semantic-release ([1df5e43](https://github.com/framersai/agentos/commit/1df5e43))
* docs: add ecosystem page with related repos ([f6ebb02](https://github.com/framersai/agentos/commit/f6ebb02))
* docs: add mood evolution and contextual prompt adaptation examples ([964aa72](https://github.com/framersai/agentos/commit/964aa72))
* docs: add multi-agent and non-streaming examples to README ([b570322](https://github.com/framersai/agentos/commit/b570322))
* docs: add Planning Engine and Agent Communication Bus documentation ([8264310](https://github.com/framersai/agentos/commit/8264310))
* docs: add Planning, HITL, Communication Bus documentation and update ARCHITECTURE.md ([9f25592](https://github.com/framersai/agentos/commit/9f25592))
* docs: add STRUCTURED_OUTPUT.md documentation ([7bd271d](https://github.com/framersai/agentos/commit/7bd271d))
* docs: fix empty RAG config, add eslint.config.js, improve README examples ([0e595d9](https://github.com/framersai/agentos/commit/0e595d9))
* docs: header/footer with AgentOS + Frame logos ([7ca834b](https://github.com/framersai/agentos/commit/7ca834b))
* docs: professional open-source README with architecture, roadmap ([7e91dc3](https://github.com/framersai/agentos/commit/7e91dc3))
* docs: remove emojis, add standalone CI workflows, fix workspace dep ([9584cee](https://github.com/framersai/agentos/commit/9584cee))
* docs: trigger docs workflow test ([279cb2d](https://github.com/framersai/agentos/commit/279cb2d))
* docs: unify Frame.dev header logo (consistent with sql-storage-adapter) ([1cc314b](https://github.com/framersai/agentos/commit/1cc314b))
* docs: update cost optimization guide ([718370c](https://github.com/framersai/agentos/commit/718370c))
* docs: update README examples with structured output, HITL, and planning ([05a8af2](https://github.com/framersai/agentos/commit/05a8af2)), closes [hi#risk](https://github.com/hi/issues/risk)
* docs(agentos): add LLM cost optimization guide ([13acef0](https://github.com/framersai/agentos/commit/13acef0))
* docs(architecture): add production emergent agency system section ([0f4ed92](https://github.com/framersai/agentos/commit/0f4ed92))
* docs(branding): use frame-logo-green-transparent-4x.png in header/footer ([43b655b](https://github.com/framersai/agentos/commit/43b655b))
* docs(evaluation): add LLM-as-Judge documentation ([4df4181](https://github.com/framersai/agentos/commit/4df4181))
* feat: automate releases with semantic-release ([cced945](https://github.com/framersai/agentos/commit/cced945))
* feat: export AgencyMemoryManager from public API ([207d22b](https://github.com/framersai/agentos/commit/207d22b))
* feat: export RAG module from public API ([43385cf](https://github.com/framersai/agentos/commit/43385cf))
* feat(agency): add cross-GMI context sharing methods ([23e8b0b](https://github.com/framersai/agentos/commit/23e8b0b))
* feat(agency): add shared RAG memory for multi-GMI collectives ([a62e3ae](https://github.com/framersai/agentos/commit/a62e3ae))
* feat(config): allow custom registry configuration ([1f93932](https://github.com/framersai/agentos/commit/1f93932))
* feat(evaluation): add agent evaluation framework with built-in scorers ([a3891ff](https://github.com/framersai/agentos/commit/a3891ff))
* feat(evaluation): add LLM-as-Judge scorer with criteria presets ([885a6b4](https://github.com/framersai/agentos/commit/885a6b4))
* feat(extensions): add multi-registry loader (npm/github/git/file/url) ([7109b1e](https://github.com/framersai/agentos/commit/7109b1e))
* feat(extensions): add persona extension kind support ([96001b4](https://github.com/framersai/agentos/commit/96001b4))
* feat(hitl): add Human-in-the-Loop manager interface and implementation ([f12a2d0](https://github.com/framersai/agentos/commit/f12a2d0))
* feat(knowledge): add knowledge graph for entity-relationship and episodic memory ([7d199d4](https://github.com/framersai/agentos/commit/7d199d4))
* feat(marketplace): add agent marketplace for publishing and discovering agents ([3fdcf3f](https://github.com/framersai/agentos/commit/3fdcf3f))
* feat(observability): add distributed tracing with span exporter ([cb81b29](https://github.com/framersai/agentos/commit/cb81b29))
* feat(permissions): default allow when subscription service missing ([18f8373](https://github.com/framersai/agentos/commit/18f8373))
* feat(personas): allow access when subscription service missing ([f5eb9cd](https://github.com/framersai/agentos/commit/f5eb9cd))
* feat(planning): add IPlanningEngine with ReAct pattern and goal decomposition ([493752d](https://github.com/framersai/agentos/commit/493752d))
* feat(rag): Add RAG memory documentation and unit tests ([c12d9fa](https://github.com/framersai/agentos/commit/c12d9fa))
* feat(rag): add SqlVectorStore using sql-storage-adapter ([b32f424](https://github.com/framersai/agentos/commit/b32f424))
* feat(sandbox): add code execution sandbox with security controls ([2f4ce03](https://github.com/framersai/agentos/commit/2f4ce03))
* feat(structured): add StructuredOutputManager for JSON schema validation and function calling ([ca6f7e8](https://github.com/framersai/agentos/commit/ca6f7e8))
* expand extension workflow runtime ([88fdb87](https://github.com/framersai/agentos/commit/88fdb87))
* Fix lint warnings for AgentOS types ([4c6b5cf](https://github.com/framersai/agentos/commit/4c6b5cf))
* Stabilize AgentOS tests and streaming ([98d33cb](https://github.com/framersai/agentos/commit/98d33cb))

## 0.1.0 (2025-12-11)

* docs: add architecture deep dive and recursive self-building analysis ([ce2982b](https://github.com/framersai/agentos/commit/ce2982b))
* docs: add changelog, typedoc config, docs index, semantic-release ([1df5e43](https://github.com/framersai/agentos/commit/1df5e43))
* docs: add ecosystem page with related repos ([f6ebb02](https://github.com/framersai/agentos/commit/f6ebb02))
* docs: add mood evolution and contextual prompt adaptation examples ([964aa72](https://github.com/framersai/agentos/commit/964aa72))
* docs: add multi-agent and non-streaming examples to README ([b570322](https://github.com/framersai/agentos/commit/b570322))
* docs: add Planning Engine and Agent Communication Bus documentation ([8264310](https://github.com/framersai/agentos/commit/8264310))
* docs: add Planning, HITL, Communication Bus documentation and update ARCHITECTURE.md ([9f25592](https://github.com/framersai/agentos/commit/9f25592))
* docs: add STRUCTURED_OUTPUT.md documentation ([7bd271d](https://github.com/framersai/agentos/commit/7bd271d))
* docs: fix empty RAG config, add eslint.config.js, improve README examples ([0e595d9](https://github.com/framersai/agentos/commit/0e595d9))
* docs: header/footer with AgentOS + Frame logos ([7ca834b](https://github.com/framersai/agentos/commit/7ca834b))
* docs: professional open-source README with architecture, roadmap ([7e91dc3](https://github.com/framersai/agentos/commit/7e91dc3))
* docs: remove emojis, add standalone CI workflows, fix workspace dep ([9584cee](https://github.com/framersai/agentos/commit/9584cee))
* docs: trigger docs workflow test ([279cb2d](https://github.com/framersai/agentos/commit/279cb2d))
* docs: unify Frame.dev header logo (consistent with sql-storage-adapter) ([1cc314b](https://github.com/framersai/agentos/commit/1cc314b))
* docs: update cost optimization guide ([718370c](https://github.com/framersai/agentos/commit/718370c))
* docs: update README examples with structured output, HITL, and planning ([05a8af2](https://github.com/framersai/agentos/commit/05a8af2)), closes [hi#risk](https://github.com/hi/issues/risk)
* docs(agentos): add LLM cost optimization guide ([13acef0](https://github.com/framersai/agentos/commit/13acef0))
* docs(architecture): add production emergent agency system section ([0f4ed92](https://github.com/framersai/agentos/commit/0f4ed92))
* docs(branding): use frame-logo-green-transparent-4x.png in header/footer ([43b655b](https://github.com/framersai/agentos/commit/43b655b))
* docs(evaluation): add LLM-as-Judge documentation ([4df4181](https://github.com/framersai/agentos/commit/4df4181))
* ci: add CI, release, and typedoc Pages workflows ([f3abfea](https://github.com/framersai/agentos/commit/f3abfea))
* ci: add CNAME for docs.agentos.sh custom domain ([11229ce](https://github.com/framersai/agentos/commit/11229ce))
* ci: add codecov coverage reporting and badge ([18b8224](https://github.com/framersai/agentos/commit/18b8224))
* ci: add coverage badge and CI workflow, update README ([3824c78](https://github.com/framersai/agentos/commit/3824c78))
* ci: add docs auto-deployment to agentos-live-docs branch ([e445b15](https://github.com/framersai/agentos/commit/e445b15))
* ci: add NODE_AUTH_TOKEN for npm publish ([4dec42f](https://github.com/framersai/agentos/commit/4dec42f))
* ci: add npm token debug step ([32a65c3](https://github.com/framersai/agentos/commit/32a65c3))
* ci: coverage badge ([12ce466](https://github.com/framersai/agentos/commit/12ce466))
* ci: enforce lint and typecheck quality gates ([8d51aff](https://github.com/framersai/agentos/commit/8d51aff))
* ci: manual releases, pnpm CI, add RELEASING.md ([0ee6fb6](https://github.com/framersai/agentos/commit/0ee6fb6))
* chore: add ESLint v9 flat config dependencies ([75556b7](https://github.com/framersai/agentos/commit/75556b7))
* chore: add release workflow (semantic-release) on master ([811a718](https://github.com/framersai/agentos/commit/811a718))
* chore: bootstrap repo (license, CI, docs templates) ([5965a4e](https://github.com/framersai/agentos/commit/5965a4e))
* chore: exclude config files from codecov coverage ([8dae2e3](https://github.com/framersai/agentos/commit/8dae2e3))
* chore: fix lint findings ([a60b3dd](https://github.com/framersai/agentos/commit/a60b3dd))
* chore: fix lint findings ([f55c22b](https://github.com/framersai/agentos/commit/f55c22b))
* chore: fix negotiation test types ([4f6da15](https://github.com/framersai/agentos/commit/4f6da15))
* chore: include release config and dev deps ([7b8e6c1](https://github.com/framersai/agentos/commit/7b8e6c1))
* chore: initial import from monorepo ([b75cd7a](https://github.com/framersai/agentos/commit/b75cd7a))
* chore: normalize file endings ([9e9a534](https://github.com/framersai/agentos/commit/9e9a534))
* chore: pin sql-storage-adapter to ^0.4.0 ([cec73d8](https://github.com/framersai/agentos/commit/cec73d8))
* chore: remove internal investigation docs ([12f7725](https://github.com/framersai/agentos/commit/12f7725))
* chore: silence unused vars in negotiation test ([16ec2bf](https://github.com/framersai/agentos/commit/16ec2bf))
* chore: sync agentos ([08a25e1](https://github.com/framersai/agentos/commit/08a25e1))
* chore: sync agentos configs ([18c46b6](https://github.com/framersai/agentos/commit/18c46b6))
* chore: sync changes ([0f67907](https://github.com/framersai/agentos/commit/0f67907))
* chore: trigger ci ([8abf707](https://github.com/framersai/agentos/commit/8abf707))
* chore: trigger release ([c0c7a1e](https://github.com/framersai/agentos/commit/c0c7a1e))
* chore: trigger release ([189e9ba](https://github.com/framersai/agentos/commit/189e9ba))
* chore: trigger release build ([9b1b59e](https://github.com/framersai/agentos/commit/9b1b59e))
* chore: trigger release build with codecov fix ([174bec9](https://github.com/framersai/agentos/commit/174bec9))
* chore: type mock negotiation test ([230b6e7](https://github.com/framersai/agentos/commit/230b6e7))
* chore: use latest @framers/sql-storage-adapter ([e9fb6a9](https://github.com/framersai/agentos/commit/e9fb6a9))
* chore(build): fail agentos dist on TS errors ([f7670f0](https://github.com/framersai/agentos/commit/f7670f0))
* chore(extensions): export multi-registry types and loaders ([8ddc2d7](https://github.com/framersai/agentos/commit/8ddc2d7))
* chore(npm): rename package to @framers/agentos; add alias; update config ([f4875b1](https://github.com/framersai/agentos/commit/f4875b1))
* feat: automate releases with semantic-release ([cced945](https://github.com/framersai/agentos/commit/cced945))
* feat: export AgencyMemoryManager from public API ([207d22b](https://github.com/framersai/agentos/commit/207d22b))
* feat: export RAG module from public API ([43385cf](https://github.com/framersai/agentos/commit/43385cf))
* feat(agency): add cross-GMI context sharing methods ([23e8b0b](https://github.com/framersai/agentos/commit/23e8b0b))
* feat(agency): add shared RAG memory for multi-GMI collectives ([a62e3ae](https://github.com/framersai/agentos/commit/a62e3ae))
* feat(config): allow custom registry configuration ([1f93932](https://github.com/framersai/agentos/commit/1f93932))
* feat(evaluation): add agent evaluation framework with built-in scorers ([a3891ff](https://github.com/framersai/agentos/commit/a3891ff))
* feat(evaluation): add LLM-as-Judge scorer with criteria presets ([885a6b4](https://github.com/framersai/agentos/commit/885a6b4))
* feat(extensions): add multi-registry loader (npm/github/git/file/url) ([7109b1e](https://github.com/framersai/agentos/commit/7109b1e))
* feat(extensions): add persona extension kind support ([96001b4](https://github.com/framersai/agentos/commit/96001b4))
* feat(hitl): add Human-in-the-Loop manager interface and implementation ([f12a2d0](https://github.com/framersai/agentos/commit/f12a2d0))
* feat(knowledge): add knowledge graph for entity-relationship and episodic memory ([7d199d4](https://github.com/framersai/agentos/commit/7d199d4))
* feat(marketplace): add agent marketplace for publishing and discovering agents ([3fdcf3f](https://github.com/framersai/agentos/commit/3fdcf3f))
* feat(observability): add distributed tracing with span exporter ([cb81b29](https://github.com/framersai/agentos/commit/cb81b29))
* feat(permissions): default allow when subscription service missing ([18f8373](https://github.com/framersai/agentos/commit/18f8373))
* feat(personas): allow access when subscription service missing ([f5eb9cd](https://github.com/framersai/agentos/commit/f5eb9cd))
* feat(planning): add IPlanningEngine with ReAct pattern and goal decomposition ([493752d](https://github.com/framersai/agentos/commit/493752d))
* feat(rag): Add RAG memory documentation and unit tests ([c12d9fa](https://github.com/framersai/agentos/commit/c12d9fa))
* feat(rag): add SqlVectorStore using sql-storage-adapter ([b32f424](https://github.com/framersai/agentos/commit/b32f424))
* feat(sandbox): add code execution sandbox with security controls ([2f4ce03](https://github.com/framersai/agentos/commit/2f4ce03))
* feat(structured): add StructuredOutputManager for JSON schema validation and function calling ([ca6f7e8](https://github.com/framersai/agentos/commit/ca6f7e8))
* fix: add missing pino dependency ([0f4afdc](https://github.com/framersai/agentos/commit/0f4afdc))
* fix: align AgencyMemoryManager with IVectorStore interface ([3ea6131](https://github.com/framersai/agentos/commit/3ea6131))
* fix: clean up CodeSandbox lint issues ([76ff4c3](https://github.com/framersai/agentos/commit/76ff4c3))
* fix: clean up unused imports and params in AgentOrchestrator ([ac32855](https://github.com/framersai/agentos/commit/ac32855))
* fix: clean up unused variables in extension loaders ([d660b03](https://github.com/framersai/agentos/commit/d660b03))
* fix: correct IVectorStoreManager import path and add type annotation ([487f5b5](https://github.com/framersai/agentos/commit/487f5b5))
* fix: guard stream responses to satisfy ts ([1d2e4f7](https://github.com/framersai/agentos/commit/1d2e4f7))
* fix: ignore pushes to closed streams ([3c70fa2](https://github.com/framersai/agentos/commit/3c70fa2))
* fix: import MetadataValue from IVectorStore to resolve type conflict ([2f90071](https://github.com/framersai/agentos/commit/2f90071))
* fix: make sql-storage-adapter optional peer dep for standalone repo ([4be6628](https://github.com/framersai/agentos/commit/4be6628))
* fix: remove unused imports and variables from LLM providers ([f21759d](https://github.com/framersai/agentos/commit/f21759d))
* fix: remove unused imports from ModelRouter ([ea2baa5](https://github.com/framersai/agentos/commit/ea2baa5))
* fix: remove unused imports from PlanningEngine ([283c42f](https://github.com/framersai/agentos/commit/283c42f))
* fix: remove unused imports from storage and RAG modules ([36c2b3f](https://github.com/framersai/agentos/commit/36c2b3f))
* fix: rename unused options param in Marketplace ([2071869](https://github.com/framersai/agentos/commit/2071869))
* fix: resolve all ESLint errors and warnings ([093ab03](https://github.com/framersai/agentos/commit/093ab03))
* fix: resolve all TypeScript build errors and update tests for new API patterns ([6b34237](https://github.com/framersai/agentos/commit/6b34237))
* fix: resolve critical parsing error in MemoryLifecycleManager ([c5c1fb6](https://github.com/framersai/agentos/commit/c5c1fb6))
* fix: resolve iterator type errors in streaming batcher ([1048fd1](https://github.com/framersai/agentos/commit/1048fd1))
* fix: resolve TypeScript errors in tests and config ([f34ea5e](https://github.com/framersai/agentos/commit/f34ea5e))
* fix: restore RetrievalAugmentor and ToolPermissionManager formatting ([f4e881a](https://github.com/framersai/agentos/commit/f4e881a))
* fix: restore variables that were incorrectly marked as unused ([5282d39](https://github.com/framersai/agentos/commit/5282d39))
* fix: type cast checkHealth to avoid TS error ([8683217](https://github.com/framersai/agentos/commit/8683217))
* fix: unignore eslint.config.js in gitignore ([9c82ab1](https://github.com/framersai/agentos/commit/9c82ab1))
* fix: update AgencyMemoryManager tests to match implementation ([853d16f](https://github.com/framersai/agentos/commit/853d16f))
* fix: update Frame.dev logo to use SVG version ([128001f](https://github.com/framersai/agentos/commit/128001f))
* fix: use workspace:* for sql-storage-adapter dependency ([2d3a88a](https://github.com/framersai/agentos/commit/2d3a88a))
* fix(agentos): use import attributes with { type: 'json' } for Node 20+ ([9e95660](https://github.com/framersai/agentos/commit/9e95660))
* fix(build): decouple tsconfig from root to fix CI path resolution ([dd14c6a](https://github.com/framersai/agentos/commit/dd14c6a))
* fix(build): include JSON; exclude tests; add getConversation/listContexts; safe casts ([86e4610](https://github.com/framersai/agentos/commit/86e4610))
* fix(build): inline tsconfig base to support standalone build ([161f5a0](https://github.com/framersai/agentos/commit/161f5a0))
* fix(build): resolve tsconfig inheritance paths ([c2bd9e7](https://github.com/framersai/agentos/commit/c2bd9e7))
* fix(ci): add pnpm version to release workflow ([9b64eca](https://github.com/framersai/agentos/commit/9b64eca))
* fix(ci): include docs workflow in path triggers ([d67005f](https://github.com/framersai/agentos/commit/d67005f))
* fix(ci): remove frozen-lockfile from docs workflow ([fbb33b0](https://github.com/framersai/agentos/commit/fbb33b0))
* fix(ci): remove pnpm cache requirement from release workflow ([d1c90ef](https://github.com/framersai/agentos/commit/d1c90ef))
* fix(esm): make AgentOS dist Node ESM compatible ([783b0e9](https://github.com/framersai/agentos/commit/783b0e9))
* fix(guardrails): add type guard for evaluateOutput to satisfy TS ([0381ca6](https://github.com/framersai/agentos/commit/0381ca6))
* fix(guardrails): avoid undefined in streaming eval; add loadPackFromFactory ([e2c4d6d](https://github.com/framersai/agentos/commit/e2c4d6d))
* fix(hitl): remove unused imports in HITL module ([3d5e67f](https://github.com/framersai/agentos/commit/3d5e67f))
* expand extension workflow runtime ([88fdb87](https://github.com/framersai/agentos/commit/88fdb87))
* Fix lint warnings for AgentOS types ([4c6b5cf](https://github.com/framersai/agentos/commit/4c6b5cf))
* Stabilize AgentOS tests and streaming ([98d33cb](https://github.com/framersai/agentos/commit/98d33cb))
* test: add comprehensive tests for workflows, extensions, and config - coverage ~67% ([672ac31](https://github.com/framersai/agentos/commit/672ac31))
* test: add logging tests and configure coverage thresholds ([511237e](https://github.com/framersai/agentos/commit/511237e))
* test: add tests for EmbeddingManager, uuid and error utilities ([979b3e2](https://github.com/framersai/agentos/commit/979b3e2))
* test: add ToolExecutor coverage ([6cb2b8c](https://github.com/framersai/agentos/commit/6cb2b8c))
* test: fix flaky timestamp ordering test in Evaluator ([56b560d](https://github.com/framersai/agentos/commit/56b560d))
* test(integration): add marketplace-evaluation integration tests ([035c646](https://github.com/framersai/agentos/commit/035c646))

# Changelog

All notable changes to **@framers/agentos** are documented in this file.

This changelog is automatically generated by [semantic-release](https://semantic-release.gitbook.io) based on [Conventional Commits](https://www.conventionalcommits.org).

---

## [0.1.0] - 2024-12-10

### Fixes (Pre-release)
- Resolved all ESLint errors and 100+ warnings across codebase
- Fixed TypeScript strict mode violations in test files
- Corrected MemoryLifecycleManager configuration interface
- Fixed ExtensionLoader test API compatibility
- Updated eslint.config.js with proper ignore patterns for underscore-prefixed variables
- Added automated docs deployment to `agentos-live-docs` branch

### Features

#### Core Runtime
- **AgentOS Orchestrator** — Unified entry point for AI agent operations
- **GMI Manager** — Generalized Mind Instance lifecycle management
- **Streaming Manager** — Real-time token-level response streaming
- **Conversation Manager** — Multi-turn context handling with history

#### Planning Engine
- **Multi-step execution plans** — Generate structured plans from high-level goals
- **Task decomposition** — Break complex tasks into manageable subtasks
- **Plan refinement** — Adapt plans based on execution feedback
- **Autonomous loops** — Continuous plan-execute-reflect cycles (ReAct pattern)
- **Confidence scoring** — Track plan reliability metrics

#### Human-in-the-Loop (HITL)
- **Approval system** — Request human approval for high-risk actions
- **Clarification requests** — Resolve ambiguous situations
- **Output review** — Submit drafts for human editing
- **Escalation handling** — Transfer control to humans when uncertain
- **Workflow checkpoints** — Progress reviews during long-running tasks

#### Agent Communication Bus
- **Direct messaging** — Point-to-point communication between agents
- **Broadcasting** — Send messages to all agents in an agency
- **Topic pub/sub** — Subscribe to channels for specific message types
- **Request/response** — Query agents and await responses with timeouts
- **Structured handoffs** — Transfer context between agents

#### RAG & Memory
- **Vector storage** — Embed and retrieve semantic memories
- **SQL storage adapter** — Persistent storage with SQLite/PostgreSQL
- **Context management** — Automatic context window optimization
- **Knowledge graph** — Entity-relationship storage and traversal

#### Extensions System
- **Tool extensions** — Custom capabilities with permission management
- **Guardrail extensions** — Safety and validation rules
- **Workflow extensions** — Multi-step process definitions
- **Planning strategies** — Customizable planning behaviors
- **Memory providers** — Pluggable vector/SQL backends

#### Evaluation Framework
- **Test case management** — Define expected behaviors
- **Scoring functions** — Exact match, semantic similarity, BLEU, ROUGE
- **LLM-as-Judge** — AI-powered evaluation scoring
- **Report generation** — JSON, Markdown, HTML outputs

### Documentation
- `ARCHITECTURE.md` — System architecture overview
- `PLANNING_ENGINE.md` — Planning and task decomposition guide
- `HUMAN_IN_THE_LOOP.md` — HITL integration guide
- `AGENT_COMMUNICATION.md` — Inter-agent messaging guide
- `EVALUATION_FRAMEWORK.md` — Testing and evaluation guide
- `STRUCTURED_OUTPUT.md` — JSON schema validation guide
- `RAG_MEMORY_CONFIGURATION.md` — Memory system setup
- `SQL_STORAGE_QUICKSTART.md` — Database integration guide

### Infrastructure
- TypeScript 5.4+ with full ESM support
- Vitest testing with 67%+ coverage
- TypeDoc API documentation generation
- Semantic-release for automated versioning
- GitHub Actions CI/CD pipeline

---

## Previous Development

For changes prior to the public release, see the [voice-chat-assistant repository](https://github.com/manicinc/voice-chat-assistant) commit history.

---

<p align="center">
  <a href="https://agentos.sh">agentos.sh</a> •
  <a href="https://github.com/framersai/agentos">GitHub</a> •
  <a href="https://www.npmjs.com/package/@framers/agentos">npm</a>
</p>
