## <small>0.1.89 (2026-03-25)</small>

* fix(ci): add ./voice subpath export to resolve @framers/agentos/voice imports ([457159a](https://github.com/framersai/agentos/commit/457159a))
* docs: update README tagline ([5d09422](https://github.com/framersai/agentos/commit/5d09422))

## <small>0.1.88 (2026-03-25)</small>

* fix(ci): resolve TS errors in voice test files — null assertions, return types, provider config ([b2caecf](https://github.com/framersai/agentos/commit/b2caecf))

## <small>0.1.87 (2026-03-25)</small>

* feat(images): add local Stable Diffusion provider with A1111 and ComfyUI support ([dc3fdeb](https://github.com/framersai/agentos/commit/dc3fdeb))

## <small>0.1.86 (2026-03-25)</small>

* fix(ci): prefer-const in NodeExecutor, prefix unused params, remove unused import ([1e44d7c](https://github.com/framersai/agentos/commit/1e44d7c))
* docs: add voice-graph integration guide to VOICE_PIPELINE.md ([fdeab10](https://github.com/framersai/agentos/commit/fdeab10))
* test(orchestration): add voice graph integration tests ([b39539a](https://github.com/framersai/agentos/commit/b39539a))

## <small>0.1.85 (2026-03-25)</small>

* feat(orchestration): add voice step support to WorkflowBuilder configToNode ([c7ed210](https://github.com/framersai/agentos/commit/c7ed210))
* feat(orchestration): add voiceNode() builder DSL and WorkflowBuilder.transport() ([8310ac5](https://github.com/framersai/agentos/commit/8310ac5))
* feat(orchestration): add VoiceTransportAdapter for voice transport mode ([8725b4c](https://github.com/framersai/agentos/commit/8725b4c))

## <small>0.1.84 (2026-03-25)</small>

* feat(orchestration): add 5 voice event variants to GraphEvent union ([5286b3a](https://github.com/framersai/agentos/commit/5286b3a))
* feat(orchestration): add voice variant to NodeExecutorConfig + VoiceNodeConfig type ([1b44b8b](https://github.com/framersai/agentos/commit/1b44b8b))
* feat(orchestration): add VoiceNodeExecutor with exit-condition racing and barge-in abort ([d4631a2](https://github.com/framersai/agentos/commit/d4631a2))
* feat(orchestration): add VoiceTurnCollector for voice node transcript buffering ([16ff7e8](https://github.com/framersai/agentos/commit/16ff7e8))
* feat(voice-pipeline): add VoiceInterruptError and public waitForUserTurn/pushToTTS methods ([57b351a](https://github.com/framersai/agentos/commit/57b351a))

## <small>0.1.83 (2026-03-24)</small>

* feat(orchestration): implement real extension node execution via extensionExecutor dep ([4782a63](https://github.com/framersai/agentos/commit/4782a63))

## <small>0.1.82 (2026-03-24)</small>

* fix(ci): update generateText test to match new provider-defaults error message ([4212cb0](https://github.com/framersai/agentos/commit/4212cb0))

## <small>0.1.81 (2026-03-24)</small>

* fix(ci): skip docs-alignment tests when cross-repo files are unavailable ([36a5d46](https://github.com/framersai/agentos/commit/36a5d46))

## <small>0.1.80 (2026-03-24)</small>

* feat(orchestration): implement real gmi/subgraph execution, expression eval, discovery/personality r ([cdd908c](https://github.com/framersai/agentos/commit/cdd908c))

## <small>0.1.79 (2026-03-24)</small>

* fix(lint): exclude stale .js from lint, suppress this-alias in VoicePipeline ([5c0527c](https://github.com/framersai/agentos/commit/5c0527c))

## <small>0.1.78 (2026-03-24)</small>

* docs: add known limitations section to VOICE_PIPELINE.md ([ea7de63](https://github.com/framersai/agentos/commit/ea7de63))
* docs: soften claims where implementation is lighter than described ([06433c0](https://github.com/framersai/agentos/commit/06433c0))
* docs: update VOICE_PIPELINE.md and add orchestration examples ([d422c57](https://github.com/framersai/agentos/commit/d422c57))
* refactor(builders): tighten builder validation and type safety ([3e62502](https://github.com/framersai/agentos/commit/3e62502))
* fix(orchestration): stop on node failure, persist skippedNodes in checkpoints, fix branch resume ([15656c8](https://github.com/framersai/agentos/commit/15656c8))

## <small>0.1.77 (2026-03-24)</small>

* docs: update examples and README for provider-first API ([6aa8387](https://github.com/framersai/agentos/commit/6aa8387))
* feat(api): add provider option to generateText, streamText, generateImage, agent ([bd4bd1a](https://github.com/framersai/agentos/commit/bd4bd1a)), closes [hi#level](https://github.com/hi/issues/level)
* feat(api): add provider-defaults registry and resolveModelOption ([ae0076a](https://github.com/framersai/agentos/commit/ae0076a))

## <small>0.1.76 (2026-03-24)</small>

* fix: update package.json deps and orchestration runtime exports ([378aa06](https://github.com/framersai/agentos/commit/378aa06))
* fix(build): cast audio.data to BodyInit, add voice-pipeline to tsconfig include ([1d3006b](https://github.com/framersai/agentos/commit/1d3006b))
* fix(build): rename LoopToolCallRequest/Result to avoid barrel collision, fix Buffer→Uint8Array in sp ([ad768bf](https://github.com/framersai/agentos/commit/ad768bf))
* fix(build): widen PipelineState comparison to avoid TS2367 narrowing error ([129c1d6](https://github.com/framersai/agentos/commit/129c1d6))
* fix(test): correct import paths in tests/api/ spec files ([4b3823e](https://github.com/framersai/agentos/commit/4b3823e))
* docs: add speech provider ecosystem guide ([de920a9](https://github.com/framersai/agentos/commit/de920a9))
* docs: add telephony provider setup and configuration guide ([49063d6](https://github.com/framersai/agentos/commit/49063d6))
* test(speech): add resolver integration test with full discovery and fallback ([d3a972f](https://github.com/framersai/agentos/commit/d3a972f))
* test(voice): add telephony integration test with full Twilio media stream flow ([323bd97](https://github.com/framersai/agentos/commit/323bd97))
* feat(agency): improve AgentCommunicationBus with typed events and examples ([f4b2c71](https://github.com/framersai/agentos/commit/f4b2c71))
* feat(speech): add AssemblyAISTTProvider with upload+poll flow ([967ef65](https://github.com/framersai/agentos/commit/967ef65))
* feat(speech): add AzureSpeechSTTProvider ([ce6f05b](https://github.com/framersai/agentos/commit/ce6f05b))
* feat(speech): add AzureSpeechTTSProvider with SSML synthesis ([fdfcbc8](https://github.com/framersai/agentos/commit/fdfcbc8))
* feat(speech): add DeepgramBatchSTTProvider ([0f9233a](https://github.com/framersai/agentos/commit/0f9233a))
* feat(speech): add FallbackSTTProxy and FallbackTTSProxy for provider chain fallback ([76d65e2](https://github.com/framersai/agentos/commit/76d65e2))
* feat(speech): add resolver types, catalog updates, mark unavailable providers ([ced86db](https://github.com/framersai/agentos/commit/ced86db))
* feat(speech): add SpeechProviderResolver with capability-based resolution and fallback ([8a3ac6b](https://github.com/framersai/agentos/commit/8a3ac6b))
* feat(speech): wire SpeechProviderResolver into SpeechRuntime ([e21c728](https://github.com/framersai/agentos/commit/e21c728))
* feat(voice): add MediaStreamParser interface and types ([2c1c6f0](https://github.com/framersai/agentos/commit/2c1c6f0))
* feat(voice): add NormalizedDtmfReceived event type and CallManager DTMF handling ([3bd70c2](https://github.com/framersai/agentos/commit/3bd70c2))
* feat(voice): add PlivoMediaStreamParser ([d0573b1](https://github.com/framersai/agentos/commit/d0573b1))
* feat(voice): add PlivoVoiceProvider with REST API and HMAC-SHA256 webhook verification ([62ba185](https://github.com/framersai/agentos/commit/62ba185))
* feat(voice): add TelephonyStreamTransport bridging phone audio to streaming pipeline ([71b36c2](https://github.com/framersai/agentos/commit/71b36c2))
* feat(voice): add TelnyxMediaStreamParser ([a7c8519](https://github.com/framersai/agentos/commit/a7c8519))
* feat(voice): add TelnyxVoiceProvider with REST API and Ed25519 webhook verification ([1cfe26c](https://github.com/framersai/agentos/commit/1cfe26c))
* feat(voice): add TwilioMediaStreamParser ([9593ce2](https://github.com/framersai/agentos/commit/9593ce2))
* feat(voice): add TwilioVoiceProvider with REST API and webhook verification ([ff455d7](https://github.com/framersai/agentos/commit/ff455d7))
* feat(voice): add TwiML/XML generation helpers for Twilio, Telnyx, Plivo ([bd8cc87](https://github.com/framersai/agentos/commit/bd8cc87))
* feat(voice): export all telephony providers, parsers, and transport ([b8db4bc](https://github.com/framersai/agentos/commit/b8db4bc))
* feat(voice): update HeuristicEndpointDetector and voice pipeline types ([dbcdf52](https://github.com/framersai/agentos/commit/dbcdf52))

## <small>0.1.75 (2026-03-24)</small>

* feat(orchestration): add judgeNode builder for LLM-as-judge evaluation ([3e176cc](https://github.com/framersai/agentos/commit/3e176cc))
* test(voice-pipeline): add full conversational loop integration test ([6c79487](https://github.com/framersai/agentos/commit/6c79487))

## <small>0.1.74 (2026-03-24)</small>

* docs: add voice pipeline architecture and configuration guide ([99dfabd](https://github.com/framersai/agentos/commit/99dfabd))
* feat(voice-pipeline): add barrel exports and update provider catalog with streaming flags ([56806ae](https://github.com/framersai/agentos/commit/56806ae))
* feat(voice-pipeline): add VoicePipelineOrchestrator state machine ([f37a25b](https://github.com/framersai/agentos/commit/f37a25b))
* feat(voice-pipeline): add WebSocketStreamTransport implementing IStreamTransport ([f05469e](https://github.com/framersai/agentos/commit/f05469e))

## <small>0.1.73 (2026-03-24)</small>

* feat(voice-pipeline): add AcousticEndpointDetector wrapping silence detection ([c683997](https://github.com/framersai/agentos/commit/c683997))
* feat(voice-pipeline): add core interfaces and types for streaming voice pipeline ([25d2dc6](https://github.com/framersai/agentos/commit/25d2dc6))
* feat(voice-pipeline): add HardCut and SoftFade barge-in handlers ([e6cde06](https://github.com/framersai/agentos/commit/e6cde06))
* feat(voice-pipeline): add HeuristicEndpointDetector with punctuation and silence detection ([1d820bc](https://github.com/framersai/agentos/commit/1d820bc))
* docs: add unified orchestration layer section to README ([1214ebd](https://github.com/framersai/agentos/commit/1214ebd))

## <small>0.1.72 (2026-03-24)</small>

* chore: update package.json with image provider dependencies ([96a58d3](https://github.com/framersai/agentos/commit/96a58d3))
* feat(api): expose generateImage and image provider config on AgentOS ([74fde7d](https://github.com/framersai/agentos/commit/74fde7d))
* feat(images): add image generation provider abstraction (OpenAI, Stability, Replicate, OpenRouter) ([dd6df60](https://github.com/framersai/agentos/commit/dd6df60))
* feat(providers): add Ollama image generation and provider tests ([9f6b6f8](https://github.com/framersai/agentos/commit/9f6b6f8))
* refactor(gmi): update GMI interfaces for image generation support ([d817ec0](https://github.com/framersai/agentos/commit/d817ec0))
* refactor(memory): update memory exports and store interfaces ([1cca340](https://github.com/framersai/agentos/commit/1cca340))
* docs: add high-level API guide and runnable examples ([a66861a](https://github.com/framersai/agentos/commit/a66861a)), closes [hi#level](https://github.com/hi/issues/level)
* docs: update README and ecosystem docs for high-level API and image generation ([12a60ab](https://github.com/framersai/agentos/commit/12a60ab)), closes [hi#level](https://github.com/hi/issues/level)
* test(api): add agent, streamText, generateImage, and docs-alignment tests ([f1b29ef](https://github.com/framersai/agentos/commit/f1b29ef))
* fix(api): restore generateImage imports now that core/images exists ([1efde67](https://github.com/framersai/agentos/commit/1efde67))

## <small>0.1.71 (2026-03-24)</small>

* fix(lint): const instead of let, remove unused eslint-disable directives ([a827082](https://github.com/framersai/agentos/commit/a827082))

## <small>0.1.70 (2026-03-24)</small>

* fix(build): add orchestration directory to tsconfig.build.json include ([25bcdcb](https://github.com/framersai/agentos/commit/25bcdcb))
* fix(build): resolve CI errors — stub generateImage, rename GraphMemoryScope, fix EventEmitter type n ([89266b6](https://github.com/framersai/agentos/commit/89266b6))
* docs: add unified orchestration layer guides (AgentGraph, workflow, mission, checkpointing) ([96437bf](https://github.com/framersai/agentos/commit/96437bf))
* docs(api): add comprehensive JSDoc to high-level API functions and rename tool-adapter to toolAdapte ([029d4a8](https://github.com/framersai/agentos/commit/029d4a8)), closes [hi#level](https://github.com/hi/issues/level)
* test(orchestration): add integration tests, compiler tests, and node builder tests ([c4a7eac](https://github.com/framersai/agentos/commit/c4a7eac))
* feat(orchestration): add AgentGraph builder with all edge types and compilation ([e56bdbb](https://github.com/framersai/agentos/commit/e56bdbb))
* feat(orchestration): add mission() API with goal interpolation, anchors, and PlanningEngine bridge ([769b5be](https://github.com/framersai/agentos/commit/769b5be))
* feat(orchestration): add SchemaLowering and GraphValidator ([e2695a9](https://github.com/framersai/agentos/commit/e2695a9))
* feat(orchestration): add typed node builder factories ([bb2762e](https://github.com/framersai/agentos/commit/bb2762e))
* feat(orchestration): add workflow() DSL with step, branch, parallel, and DAG enforcement ([76f3eb0](https://github.com/framersai/agentos/commit/76f3eb0))
* feat(orchestration): complete unified orchestration layer — all 4 phases ([cef73ce](https://github.com/framersai/agentos/commit/cef73ce))

## <small>0.1.69 (2026-03-23)</small>

* feat(orchestration): add GraphRuntime with execute, stream, resume, and conditional edges ([00a51e6](https://github.com/framersai/agentos/commit/00a51e6))

## <small>0.1.68 (2026-03-23)</small>

* feat(orchestration): add LoopController with configurable ReAct loop ([db43313](https://github.com/framersai/agentos/commit/db43313))
* feat(orchestration): add NodeExecutor with type-based dispatch and timeout ([7a9b6f7](https://github.com/framersai/agentos/commit/7a9b6f7))

## <small>0.1.67 (2026-03-23)</small>

* feat(orchestration): add NodeScheduler with topological sort and cycle detection ([90fffbf](https://github.com/framersai/agentos/commit/90fffbf))
* feat(orchestration): add StateManager with partition management and reducers ([08db90e](https://github.com/framersai/agentos/commit/08db90e))

## <small>0.1.66 (2026-03-23)</small>

* feat(orchestration): add ICheckpointStore interface and InMemoryCheckpointStore ([8a64e8f](https://github.com/framersai/agentos/commit/8a64e8f))

## <small>0.1.65 (2026-03-23)</small>

* feat(orchestration): add GraphEvent types and EventEmitter ([f948644](https://github.com/framersai/agentos/commit/f948644))

## <small>0.1.64 (2026-03-23)</small>

* feat(orchestration): add CompiledExecutionGraph IR types ([0e13ac6](https://github.com/framersai/agentos/commit/0e13ac6))
* docs: update README tagline and overview for AgentOS rebrand ([bf24204](https://github.com/framersai/agentos/commit/bf24204))
* ci: trigger docs rebuild after release ([e890865](https://github.com/framersai/agentos/commit/e890865))

## <small>0.1.63 (2026-03-23)</small>

* fix(api): cast finishReason to union type ([de7cf97](https://github.com/framersai/agentos/commit/de7cf97))
* fix(api): use camelCase ModelCompletionResponse fields (finishReason, promptTokens) ([7479f34](https://github.com/framersai/agentos/commit/7479f34))
* fix(api): use correct IProvider method signatures (generateCompletion/generateCompletionStream) ([6d63c7d](https://github.com/framersai/agentos/commit/6d63c7d))
* feat(api): add agent() factory with sessions and multi-turn memory ([69dc854](https://github.com/framersai/agentos/commit/69dc854))
* feat(api): add generateText — stateless text generation with tool support ([7d4d708](https://github.com/framersai/agentos/commit/7d4d708))
* feat(api): add model string parser with env key resolution ([75b2810](https://github.com/framersai/agentos/commit/75b2810))
* feat(api): add streamText — stateless streaming with async iterables ([6347aa6](https://github.com/framersai/agentos/commit/6347aa6))
* feat(api): add tool adapter for Zod/JSON Schema/ITool normalization ([eb4c324](https://github.com/framersai/agentos/commit/eb4c324))
* feat(api): export generateText, streamText, agent from package root ([8898a9e](https://github.com/framersai/agentos/commit/8898a9e))
* feat(guardrails): add sentence boundary buffering for streaming evaluation ([5a92dd3](https://github.com/framersai/agentos/commit/5a92dd3))

## <small>0.1.62 (2026-03-23)</small>

* feat: add multi-agent workflow example with parallel + sequential DAG execution ([348570a](https://github.com/framersai/agentos/commit/348570a))

## <small>0.1.61 (2026-03-23)</small>

* fix(test): correct import path in MarkdownWorkingMemory.spec.ts ([53bb6ac](https://github.com/framersai/agentos/commit/53bb6ac))
* docs: add memory auto-ingest pipeline guide ([0644faf](https://github.com/framersai/agentos/commit/0644faf))
* docs: add persistent markdown working memory guide ([a41447f](https://github.com/framersai/agentos/commit/a41447f))
* docs: add persistent working memory cross-reference to cognitive memory guide ([4520ee1](https://github.com/framersai/agentos/commit/4520ee1))
* test(memory): add unit tests for working memory tools ([c9f670c](https://github.com/framersai/agentos/commit/c9f670c))

## <small>0.1.60 (2026-03-22)</small>

* feat(memory): add MarkdownWorkingMemory — persistent .md file for agent context ([0ed30c4](https://github.com/framersai/agentos/commit/0ed30c4))
* feat(memory): add update_working_memory and read_working_memory tools ([3fe1840](https://github.com/framersai/agentos/commit/3fe1840))
* feat(memory): export MarkdownWorkingMemory and tools from barrel ([1117e23](https://github.com/framersai/agentos/commit/1117e23))
* feat(memory): inject persistent markdown memory into prompt assembler ([4ed34d1](https://github.com/framersai/agentos/commit/4ed34d1))
* docs: add sql-storage-adapter as persistence layer in README ([71fbfa8](https://github.com/framersai/agentos/commit/71fbfa8))
* docs: convert all remaining ASCII diagrams to Mermaid ([c95afb1](https://github.com/framersai/agentos/commit/c95afb1))
* docs: replace ASCII architecture diagrams with Mermaid ([d5f9937](https://github.com/framersai/agentos/commit/d5f9937))

## <small>0.1.59 (2026-03-22)</small>

* refactor: rename @framers/agentos-ext-skills to @framers/agentos-skills ([7ae18a7](https://github.com/framersai/agentos/commit/7ae18a7))
* docs: add comprehensive Creating Custom Guardrails authoring guide ([0ee68e5](https://github.com/framersai/agentos/commit/0ee68e5))
* docs: add ecosystem table with all packages and links ([9464cb8](https://github.com/framersai/agentos/commit/9464cb8))
* docs: agentos-extensions is "Extension source" not "Extensions Catalog" ([bdec7af](https://github.com/framersai/agentos/commit/bdec7af))
* docs: clarify agentos-ext-skills description in ecosystem table ([4401372](https://github.com/framersai/agentos/commit/4401372))
* docs: move ecosystem after overview, remove external apps ([a2f06c1](https://github.com/framersai/agentos/commit/a2f06c1))
* docs: simplify guardrails table to 3 columns to fix overflow on docs site ([f25178e](https://github.com/framersai/agentos/commit/f25178e))
* docs: update factory function names from create*Pack to create*Guardrail ([2bb37f8](https://github.com/framersai/agentos/commit/2bb37f8))

## <small>0.1.58 (2026-03-21)</small>

* fix(lint): resolve 2 prefer-const errors in ParallelGuardrailDispatcher ([56468b0](https://github.com/framersai/agentos/commit/56468b0))
* docs: update import paths to @framers/agentos-ext-* packages, promote PII extension as primary examp ([95d6ede](https://github.com/framersai/agentos/commit/95d6ede))

## <small>0.1.57 (2026-03-21)</small>

* refactor: move 5 guardrail extension packs to agentos-extensions/registry/curated/safety/ ([7599983](https://github.com/framersai/agentos/commit/7599983))
* refactor(guardrails): export helper functions for reuse by ParallelGuardrailDispatcher ([04a57b5](https://github.com/framersai/agentos/commit/04a57b5))
* docs: add createPiiRedactionGuardrail callout after custom guardrail regex example ([4f125c1](https://github.com/framersai/agentos/commit/4f125c1))
* docs: update core AgentOS docs to match shipped guardrail runtime ([acd09d5](https://github.com/framersai/agentos/commit/acd09d5))
* fix(topicality): clear guardrail-owned drift tracker on deactivation ([d509dda](https://github.com/framersai/agentos/commit/d509dda))
* feat: add cosineSimilarity to shared text-utils ([9241c26](https://github.com/framersai/agentos/commit/9241c26))
* feat: add shared text-utils module (clamp, parseJsonResponse, tokenize, normalizeText, estimateToken ([5ba9940](https://github.com/framersai/agentos/commit/5ba9940))
* feat(code-safety): add ~25 default rules covering OWASP Top 10 ([4dabccb](https://github.com/framersai/agentos/commit/4dabccb))
* feat(code-safety): add barrel export + package.json exports path ([4c78266](https://github.com/framersai/agentos/commit/4c78266))
* feat(code-safety): add CodeSafetyGuardrail with fence-boundary buffering + tool call scanning ([eadcfc2](https://github.com/framersai/agentos/commit/eadcfc2))
* feat(code-safety): add CodeSafetyScanner with language-aware pattern matching ([a72e7cf](https://github.com/framersai/agentos/commit/a72e7cf))
* feat(code-safety): add createCodeSafetyGuardrail factory ([f07b636](https://github.com/framersai/agentos/commit/f07b636))
* feat(code-safety): add ScanCodeTool for on-demand scanning ([7873a29](https://github.com/framersai/agentos/commit/7873a29))
* feat(code-safety): add types, CodeFenceExtractor with language detection ([ddbe847](https://github.com/framersai/agentos/commit/ddbe847))
* feat(grounding): add barrel export + package.json exports path ([702cbcf](https://github.com/framersai/agentos/commit/702cbcf))
* feat(grounding): add CheckGroundingTool for on-demand verification ([9e468fa](https://github.com/framersai/agentos/commit/9e468fa))
* feat(grounding): add createGroundingGuardrail factory ([4df52f5](https://github.com/framersai/agentos/commit/4df52f5))
* feat(grounding): add GroundingGuardrail with streaming + final verification ([9659e41](https://github.com/framersai/agentos/commit/9659e41))
* feat(grounding): add types, ClaimExtractor with heuristic split + LLM decomposition ([9247445](https://github.com/framersai/agentos/commit/9247445))
* feat(guardrails): add canSanitize and timeoutMs to GuardrailConfig ([934228c](https://github.com/framersai/agentos/commit/934228c))
* feat(guardrails): add ParallelGuardrailDispatcher with two-phase execution ([1ed3ed4](https://github.com/framersai/agentos/commit/1ed3ed4))
* feat(guardrails): add ragSources plumbing from response chunks to guardrail payloads ([cf26569](https://github.com/framersai/agentos/commit/cf26569))
* feat(guardrails): delegate to ParallelGuardrailDispatcher, extract normalizeServices ([bfc22a0](https://github.com/framersai/agentos/commit/bfc22a0))
* feat(ml-classifiers): add barrel export + package.json exports path ([267219d](https://github.com/framersai/agentos/commit/267219d))
* feat(ml-classifiers): add ClassifierOrchestrator with parallel execution and worst-wins ([69efbd3](https://github.com/framersai/agentos/commit/69efbd3))
* feat(ml-classifiers): add ClassifyContentTool for on-demand classification ([69e5df6](https://github.com/framersai/agentos/commit/69e5df6))
* feat(ml-classifiers): add core types, config interfaces, and IContentClassifier ([931e60e](https://github.com/framersai/agentos/commit/931e60e))
* feat(ml-classifiers): add createMLClassifierGuardrail factory with guardrail + tool ([ae999fe](https://github.com/framersai/agentos/commit/ae999fe))
* feat(ml-classifiers): add MLClassifierGuardrail with sliding window + 3 streaming modes ([31fb998](https://github.com/framersai/agentos/commit/31fb998))
* feat(ml-classifiers): add SlidingWindowBuffer with context carry-forward ([68e0aee](https://github.com/framersai/agentos/commit/68e0aee))
* feat(ml-classifiers): add Toxicity, Injection, and Jailbreak classifiers ([4e96f92](https://github.com/framersai/agentos/commit/4e96f92))
* feat(ml-classifiers): add WorkerClassifierProxy for browser Web Worker support ([2dc4417](https://github.com/framersai/agentos/commit/2dc4417))
* feat(pii): add canSanitize: true to PiiRedactionGuardrail config ([4894e0a](https://github.com/framersai/agentos/commit/4894e0a))
* feat(topicality): add barrel export + package.json exports path ([f575358](https://github.com/framersai/agentos/commit/f575358))
* feat(topicality): add CheckTopicTool and createTopicalityGuardrail factory ([95da69d](https://github.com/framersai/agentos/commit/95da69d))
* feat(topicality): add core types, TopicDescriptor, DriftConfig, and TOPIC_PRESETS ([341db10](https://github.com/framersai/agentos/commit/341db10))
* feat(topicality): add TopicalityGuardrail with forbidden/allowed/drift detection ([4a030db](https://github.com/framersai/agentos/commit/4a030db))
* feat(topicality): add TopicDriftTracker with EMA drift detection ([fbbeca7](https://github.com/framersai/agentos/commit/fbbeca7))
* feat(topicality): add TopicEmbeddingIndex with centroid embedding and matchByVector ([c6fb1db](https://github.com/framersai/agentos/commit/c6fb1db))

## <small>0.1.56 (2026-03-20)</small>

* feat: add ISharedServiceRegistry + wire into ExtensionManager ([e9ff33c](https://github.com/framersai/agentos/commit/e9ff33c))
* feat(pii): add barrel export + package.json exports path for PII pack ([1cd9b51](https://github.com/framersai/agentos/commit/1cd9b51))
* feat(pii): add core PII types, entity types, and config interfaces ([7b740f0](https://github.com/framersai/agentos/commit/7b740f0))
* feat(pii): add createPiiRedactionGuardrail factory with guardrail + tools ([bba05f1](https://github.com/framersai/agentos/commit/bba05f1))
* feat(pii): add EntityMerger with overlap resolution and allow/denylist ([0daf331](https://github.com/framersai/agentos/commit/0daf331))
* feat(pii): add IEntityRecognizer internal interface ([ea6116e](https://github.com/framersai/agentos/commit/ea6116e))
* feat(pii): add LlmJudgeRecognizer (Tier 4) with CoT prompt and LRU cache ([58050d0](https://github.com/framersai/agentos/commit/58050d0))
* feat(pii): add NerModelRecognizer (Tier 3) with HuggingFace transformers ([d1d8d64](https://github.com/framersai/agentos/commit/d1d8d64))
* feat(pii): add NlpPrefilterRecognizer (Tier 2) with compromise ([c7ecc9b](https://github.com/framersai/agentos/commit/c7ecc9b))
* feat(pii): add PiiDetectionPipeline with 4-tier gating and context enhancement ([fba6878](https://github.com/framersai/agentos/commit/fba6878))
* feat(pii): add PiiRedactionGuardrail with streaming sentence-boundary buffer ([56bd1e1](https://github.com/framersai/agentos/commit/56bd1e1))
* feat(pii): add PiiScanTool and PiiRedactTool ([21a4fd4](https://github.com/framersai/agentos/commit/21a4fd4))
* feat(pii): add RedactionEngine with 4 redaction styles ([a99de2a](https://github.com/framersai/agentos/commit/a99de2a))
* feat(pii): add RegexRecognizer (Tier 1) with openredaction ([e8ade47](https://github.com/framersai/agentos/commit/e8ade47))
* docs: update guardrails with PII redaction extension example + shared services ([a4d6ace](https://github.com/framersai/agentos/commit/a4d6ace))
* chore: add openredaction + optional NLP deps for PII extension ([d3ca7f5](https://github.com/framersai/agentos/commit/d3ca7f5))

## <small>0.1.55 (2026-03-18)</small>

* fix: quote mermaid labels with parentheses (Docusaurus parse error) ([b11a0ff](https://github.com/framersai/agentos/commit/b11a0ff))

## <small>0.1.54 (2026-03-17)</small>

* fix: update SkillRegistry emoji encoding + add ecosystem doc ([9f30ce2](https://github.com/framersai/agentos/commit/9f30ce2))
* docs(skills): clarify skills barrel export + relationship to @framers/agentos-skills ([fa0a66b](https://github.com/framersai/agentos/commit/fa0a66b))

## <small>0.1.53 (2026-03-17)</small>

* fix: codex audit — barrel exports, type fixes, AgentOS cleanup ([fc1918f](https://github.com/framersai/agentos/commit/fc1918f))
* docs: add all guide links to TypeDoc sidebar ([bacb388](https://github.com/framersai/agentos/commit/bacb388))
* docs: add observational memory section to RAG guide ([80a47e3](https://github.com/framersai/agentos/commit/80a47e3))
* docs: update RAG guide — document AgentMemory facade, HydeRetriever ([bad35ab](https://github.com/framersai/agentos/commit/bad35ab))

## <small>0.1.52 (2026-03-16)</small>

* feat(memory): add AgentMemory high-level facade ([9eae701](https://github.com/framersai/agentos/commit/9eae701)), closes [hi#level](https://github.com/hi/issues/level)

## <small>0.1.51 (2026-03-16)</small>

* fix(telegram): resolve 409 Conflict from stale polling sessions ([ec30f23](https://github.com/framersai/agentos/commit/ec30f23))

## <small>0.1.50 (2026-03-16)</small>

* feat: add barrel exports for 6 core subsystems ([6075721](https://github.com/framersai/agentos/commit/6075721))
* feat: add core/tools barrel export (fixes published path) ([6ca59dd](https://github.com/framersai/agentos/commit/6ca59dd))
* feat: add domain-organized barrel for core subsystems ([42b819c](https://github.com/framersai/agentos/commit/42b819c))
* feat: extract TaskOutcomeTelemetryManager delegate class ([7dee359](https://github.com/framersai/agentos/commit/7dee359))
* feat: implement HybridUtilityAI (was empty placeholder) ([189f090](https://github.com/framersai/agentos/commit/189f090))
* fix: correct test type mismatches against actual interfaces ([9e038bc](https://github.com/framersai/agentos/commit/9e038bc))
* refactor: extract 4 turn-phase helpers + wire StreamChunkEmitter ([006934c](https://github.com/framersai/agentos/commit/006934c))
* refactor: extract AgentOSServiceError and AsyncStreamClientBridge ([8764f53](https://github.com/framersai/agentos/commit/8764f53))
* refactor: extract orchestrator config types to OrchestratorConfig.ts ([c3ad19e](https://github.com/framersai/agentos/commit/c3ad19e))
* refactor: extract StreamChunkEmitter delegate from orchestrator ([a9b6444](https://github.com/framersai/agentos/commit/a9b6444))
* refactor: remove dead code from AgentOSOrchestrator ([f966c76](https://github.com/framersai/agentos/commit/f966c76))
* refactor: wire TaskOutcomeTelemetryManager into orchestrator ([d80bd95](https://github.com/framersai/agentos/commit/d80bd95))
* test: add 122 tests for extracted modules ([0023ce0](https://github.com/framersai/agentos/commit/0023ce0))
* chore(release): v0.1.50 — HyDE retriever, quiet EmbeddingManager ([68eea3c](https://github.com/framersai/agentos/commit/68eea3c))

## <small>0.1.49 (2026-03-16)</small>

* fix(hyde): adaptive threshold counting, config validation, quiet logs ([7dae907](https://github.com/framersai/agentos/commit/7dae907))
* test: add HyDE retriever unit tests (409 lines) ([dc72810](https://github.com/framersai/agentos/commit/dc72810))

## <small>0.1.48 (2026-03-15)</small>

* feat: add HyDE (Hypothetical Document Embedding) retriever ([bf621b4](https://github.com/framersai/agentos/commit/bf621b4))
* chore: linter fixes — OllamaProvider, CapabilityIndex, SpeechRuntime ([15cc6f0](https://github.com/framersai/agentos/commit/15cc6f0))

## <small>0.1.47 (2026-03-15)</small>

* fix: downgrade embedding batch errors to console.debug ([197f21e](https://github.com/framersai/agentos/commit/197f21e))
* chore(release): v0.1.47 — add speech + memory subpath exports ([8a8b441](https://github.com/framersai/agentos/commit/8a8b441))

## <small>0.1.46 (2026-03-14)</small>

* fix: add logo assets and fix README image URLs ([3609985](https://github.com/framersai/agentos/commit/3609985))
* docs: fix README logos, remove stale file counts, add speech module ([1eec2cf](https://github.com/framersai/agentos/commit/1eec2cf))

## <small>0.1.45 (2026-03-14)</small>

* feat(memory): add infinite context window system (Batch 3) ([f12587b](https://github.com/framersai/agentos/commit/f12587b))
* docs: add document tools to guardrails usage overview ([ba43843](https://github.com/framersai/agentos/commit/ba43843))

## <small>0.1.44 (2026-03-13)</small>

* feat(memory): enhance cognitive memory — typed taxonomy, scope hydration, prospective API ([833adb0](https://github.com/framersai/agentos/commit/833adb0))

## <small>0.1.43 (2026-03-13)</small>

* fix(memory): resolve lint errors — prefer-const and no-misleading-character-class ([e7e93a9](https://github.com/framersai/agentos/commit/e7e93a9))
* fix(memory): revert semanticBudget to let — it is reassigned downstream ([10931e8](https://github.com/framersai/agentos/commit/10931e8))

## <small>0.1.42 (2026-03-13)</small>

* fix(build): add src/memory/**/*.ts to tsconfig.build.json include list ([a5c61d2](https://github.com/framersai/agentos/commit/a5c61d2))
* feat(memory): add cognitive memory system — episodic, semantic, procedural, prospective traces ([d4c6ba7](https://github.com/framersai/agentos/commit/d4c6ba7))
* chore(deps): bump sql-storage-adapter peer dep to >=0.5.0 ([911bc3e](https://github.com/framersai/agentos/commit/911bc3e))

## <small>0.1.41 (2026-03-08)</small>

* feat(auth): browser-based PKCE OAuth for OpenAI + API key exchange ([a9177ea](https://github.com/framersai/agentos/commit/a9177ea))
* Add social abstract service, OAuth flows, and expanded secret catalog ([bad9841](https://github.com/framersai/agentos/commit/bad9841))

## <small>0.1.40 (2026-03-05)</small>

* feat(social-posting): add SocialPostManager, ContentAdaptationEngine, and new ChannelPlatform types ([c26feb6](https://github.com/framersai/agentos/commit/c26feb6))

## <small>0.1.39 (2026-03-04)</small>

* feat(auth): add browser-based OAuth 2.0 flows for Twitter/X and Instagram ([75af64d](https://github.com/framersai/agentos/commit/75af64d))
* feat(config): add Twitter OAuth and Meta OAuth extension secrets ([6036de2](https://github.com/framersai/agentos/commit/6036de2))

## <small>0.1.38 (2026-03-04)</small>

* feat(config): add github.token to extension secrets ([d505070](https://github.com/framersai/agentos/commit/d505070))

## <small>0.1.37 (2026-03-04)</small>

* fix: resolve CapabilityGraph test failures and lint warnings ([f9e6c08](https://github.com/framersai/agentos/commit/f9e6c08))

## <small>0.1.36 (2026-03-04)</small>

* fix(config): add Twitter/X env var aliases to extension-secrets.json ([8ac68ef](https://github.com/framersai/agentos/commit/8ac68ef))

## <small>0.1.35 (2026-03-02)</small>

* fix: lint errors + bump to 0.1.34 ([67d55a6](https://github.com/framersai/agentos/commit/67d55a6))

## <small>0.1.34 (2026-03-02)</small>

* fix: lazy-load graphology to prevent crash when optional peer dep missing ([9ab5e61](https://github.com/framersai/agentos/commit/9ab5e61))

## <small>0.1.33 (2026-03-01)</small>

* fix(build): avoid unused ts-expect-error in optional neo4j import ([f9cc8b1](https://github.com/framersai/agentos/commit/f9cc8b1))
* docs(rag): document neo4j memory providers and unreleased notes ([214bc0d](https://github.com/framersai/agentos/commit/214bc0d))
* feat(memory): add neo4j stores and adaptive task-outcome telemetry ([536c249](https://github.com/framersai/agentos/commit/536c249))

## [Unreleased]

### Added
- feat(memory): Neo4j-backed memory providers for RAG (`Neo4jVectorStore`, `Neo4jGraphRAGEngine`) plus adaptive task-outcome telemetry hooks.

## <small>0.1.32 (2026-02-24)</small>

* feat(auth): add OAuth authentication module for LLM providers ([b72a33f](https://github.com/framersai/agentos/commit/b72a33f))

## <small>0.1.31 (2026-02-23)</small>

* fix(lint): merge duplicate 'embed' case labels in channel adapters ([047b33a](https://github.com/framersai/agentos/commit/047b33a))

## <small>0.1.30 (2026-02-23)</small>

* fix: include discovery/ in tsconfig.build.json and fix type errors ([3ddf297](https://github.com/framersai/agentos/commit/3ddf297))
* docs(discovery): add CAPABILITY_DISCOVERY.md architecture documentation ([3550f33](https://github.com/framersai/agentos/commit/3550f33))
* docs(rag): document combined vector+GraphRAG search, debug tracing, HNSW config ([1f3e2ea](https://github.com/framersai/agentos/commit/1f3e2ea))
* feat(discovery): add Capability Discovery Engine — semantic, tiered capability discovery ([790364c](https://github.com/framersai/agentos/commit/790364c))
* feat(discovery): integrate with ToolOrchestrator, update CHANGELOG and exports ([dff5cb0](https://github.com/framersai/agentos/commit/dff5cb0))
* test(discovery): add unit tests for all discovery module components ([c69962e](https://github.com/framersai/agentos/commit/c69962e))

## [0.1.30] - 2026-02-21

### Added
- **Capability Discovery Engine** — Semantic, tiered capability discovery system that reduces context tokens by ~90% (from ~20,000 to ~1,850 tokens)
  - `CapabilityDiscoveryEngine`: Main orchestrator coordinating index, graph, and assembler
  - `CapabilityIndex`: Vector index over tools, skills, extensions, and channels using IEmbeddingManager + IVectorStore
  - `CapabilityGraph`: Graphology-based relationship graph with DEPENDS_ON, COMPOSED_WITH, SAME_CATEGORY, TAGGED_WITH edges
  - `CapabilityContextAssembler`: Token-budgeted three-tier context builder (Tier 0: always, Tier 1: retrieved, Tier 2: full)
  - `CapabilityEmbeddingStrategy`: Intent-oriented embedding text construction
  - `CapabilityManifestScanner`: File-based CAPABILITY.yaml discovery with hot-reload
  - `createDiscoverCapabilitiesTool()`: Meta-tool factory for agent self-discovery (~80 tokens)
- `IToolOrchestrator.listDiscoveredTools()` — Filter tool list to only discovery-relevant tools
- `PromptBuilder.buildCapabilitiesSection()` — Render tiered discovery context in system prompts

## <small>0.1.29 (2026-02-21)</small>

* fix: remove userApiKeys from conversation metadata ([f774f4b](https://github.com/framersai/agentos/commit/f774f4b))

## <small>0.1.28 (2026-02-20)</small>

* fix: resolve CI build errors in channel adapters ([144bd14](https://github.com/framersai/agentos/commit/144bd14))
* feat: P0+P1 channel adapters for 13 messaging platforms ([5e546df](https://github.com/framersai/agentos/commit/5e546df))

## <small>0.1.27 (2026-02-19)</small>

* fix: resolve all lint errors and warnings from CI #186 ([9a5ba08](https://github.com/framersai/agentos/commit/9a5ba08)), closes [#186](https://github.com/framersai/agentos/issues/186)

## <small>0.1.26 (2026-02-19)</small>

* feat: 28-channel parity — add IRC + Zalo Personal types, Telegram forum-topic routing ([ff33916](https://github.com/framersai/agentos/commit/ff33916)), closes [chatId#topicId](https://github.com/chatId/issues/topicId)

## <small>0.1.25 (2026-02-18)</small>

* feat(channels): expand platform types and secrets schema ([badf375](https://github.com/framersai/agentos/commit/badf375))

## <small>0.1.24 (2026-02-16)</small>

* feat: RAG audit trail — types, collector, pipeline instrumentation, tests ([e40fe00](https://github.com/framersai/agentos/commit/e40fe00))

## <small>0.1.23 (2026-02-12)</small>

* feat: add per-agent workspace directory helpers ([f4f8617](https://github.com/framersai/agentos/commit/f4f8617))
* chore: bump version to 0.1.23 (workspace exports in dist) ([d9d342c](https://github.com/framersai/agentos/commit/d9d342c))

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
