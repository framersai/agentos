# AgentOS Image System Upgrade — Providers, Character Consistency, Style Transfer

**Date:** 2026-04-05
**Scope:** `packages/agentos/` — upstream image system modernization. Wilds-AI integration is a separate downstream spec (`apps/wilds-ai/docs/superpowers/specs/2026-04-05-parasitic-integration-design.md`).

---

## 1. Replicate Provider Modernization

### Problem

`ReplicateImageProvider` lists 3 models (flux-schnell, flux-dev, flux-pro), uses the older `/predictions` endpoint with a `version` field, and has zero unit tests. The Replicate ecosystem now includes Flux 1.1 Pro, Flux Redux (style transfer), Flux Canny/Depth (ControlNet), Pulid (face consistency), SDXL Lightning, and Flux Fill Pro (inpainting).

### Changes

#### 1a. Dual-Endpoint Support

Official BFL models on Replicate now use `/models/{owner}/{name}/predictions` instead of the generic `/predictions` with a `version` field. Both must be supported.

New private method in `ReplicateImageProvider`:

```typescript
/**
 * Creates a prediction using the newer model-based endpoint.
 *
 * Used for official models registered on Replicate (e.g. `black-forest-labs/flux-1.1-pro`)
 * that don't require a version hash. Falls back to the legacy version-based endpoint
 * when the model ID contains a colon (indicating an explicit version hash).
 *
 * @param owner - Model owner (e.g. `'black-forest-labs'`).
 * @param name - Model name (e.g. `'flux-1.1-pro'`).
 * @param input - Model input parameters.
 * @param waitSeconds - Maximum seconds to wait for synchronous completion.
 * @returns The prediction response, possibly still in progress.
 */
private async createModelPrediction(
  owner: string,
  name: string,
  input: Record<string, unknown>,
  waitSeconds: number,
): Promise<ReplicatePrediction>
```

Detection logic in `generateImage()`:

```typescript
const modelId = request.modelId || this.defaultModelId || 'black-forest-labs/flux-schnell';
const hasVersionHash = modelId.includes(':');

if (hasVersionHash) {
  // Legacy: POST /predictions with { version: modelId, input }
  prediction = await this.createPrediction({ version: modelId, input }, waitSeconds);
} else {
  // Modern: POST /models/{owner}/{name}/predictions with { input }
  const [owner, name] = modelId.split('/');
  prediction = await this.createModelPrediction(owner, name, input, waitSeconds);
}
```

#### 1b. Expanded Model Catalog

`listAvailableModels()` returns the full current Replicate image model ecosystem:

| Model ID | Display Name | Category |
|----------|-------------|----------|
| `black-forest-labs/flux-schnell` | Flux Schnell | Generation (fast) |
| `black-forest-labs/flux-dev` | Flux Dev | Generation (open-weight) |
| `black-forest-labs/flux-pro` | Flux Pro | Generation (commercial) |
| `black-forest-labs/flux-1.1-pro` | Flux 1.1 Pro | Generation (latest) |
| `black-forest-labs/flux-1.1-pro-ultra` | Flux 1.1 Pro Ultra | Generation (ultra-res) |
| `bytedance/sdxl-lightning-4step` | SDXL Lightning | Generation (4-step fast) |
| `stability-ai/sdxl` | SDXL | Generation (classic) |
| `black-forest-labs/flux-redux-dev` | Flux Redux Dev | Style transfer |
| `black-forest-labs/flux-canny-dev` | Flux Canny | ControlNet (edge-guided) |
| `black-forest-labs/flux-depth-dev` | Flux Depth | ControlNet (depth-guided) |
| `zsxkib/pulid` | Pulid | Character consistency |
| `black-forest-labs/flux-fill-pro` | Flux Fill Pro | Inpainting |
| `nightmareai/real-esrgan` | Real-ESRGAN | Upscaling |

Each entry includes `description` field for programmatic model selection.

#### 1c. Character Consistency via Reference Image

New fields on `ReplicateImageProviderOptions`:

```typescript
export interface ReplicateImageProviderOptions {
  // ... existing fields ...

  /**
   * Reference image URL for character/face consistency.
   *
   * Mapped to provider-specific inputs based on the target model:
   * - Pulid (`zsxkib/pulid`): `main_face_image`
   * - Flux Redux (`flux-redux-dev`): `image`
   * - Standard Flux models: `image` with `image_strength` derived from consistency mode
   *
   * Ignored when the target model does not support reference images.
   */
  referenceImageUrl?: string;

  /**
   * Control image URL for ControlNet-style guided generation.
   *
   * Mapped to model-specific inputs:
   * - Flux Canny (`flux-canny-dev`): `control_image`
   * - Flux Depth (`flux-depth-dev`): `control_image`
   *
   * Ignored when the target model does not support control images.
   */
  controlImage?: string;

  /**
   * Control type hint for automatic model routing when `controlImage` is set
   * but no explicit model is specified.
   *
   * - `'canny'` → routes to `black-forest-labs/flux-canny-dev`
   * - `'depth'` → routes to `black-forest-labs/flux-depth-dev`
   * - `'pose'` → routes to community pose model (future)
   */
  controlType?: 'canny' | 'depth' | 'pose';
}
```

#### 1d. `editImage()` Model Routing Update

Current routing: `flux-fill` for inpaint, `stability-ai/sdxl` for generic img2img.

Updated routing:

```typescript
const defaultModel = hasInpaintingMask
  ? 'black-forest-labs/flux-fill-pro'    // Upgraded from flux-fill to flux-fill-pro
  : 'stability-ai/sdxl';
```

### Files Touched

- **Modify:** `src/media/images/providers/ReplicateImageProvider.ts`
- **New:** `src/media/images/__tests__/ReplicateImageProvider.spec.ts` (~25 tests)

---

## 2. Fal Provider Expansion + Style Transfer API

### 2a. Fal `editImage()` Support

Add `editImage()` to `FalImageProvider`. Fal-hosted Flux models accept image inputs via the standard queue API.

```typescript
/**
 * Edit an image using a Fal.ai-hosted Flux model.
 *
 * Supports img2img (prompt-guided transformation) and inpainting
 * (mask-guided regional editing). The source image is passed as a
 * base64 data URL in the `image` field of the model input.
 *
 * - **img2img default model:** `fal-ai/flux/dev` (accepts `image` + `strength`)
 * - **Inpaint default model:** `fal-ai/flux-fill` (accepts `image` + `mask`)
 *
 * @param request - Edit request with source image, prompt, and optional mask.
 * @returns Generation result with the edited image(s).
 * @throws {Error} When the provider is not initialised or the API fails.
 */
async editImage(request: ImageEditRequest): Promise<ImageGenerationResult>
```

Implementation:
- Convert `request.image` Buffer to base64 data URL
- If mask present: route to inpaint-capable Fal model (verify `fal-ai/flux-fill` availability at implementation; fall back to `fal-ai/flux/dev` with mask in prompt if not available), set `mask` as base64 data URL
- If no mask: route to `fal-ai/flux/dev`, set `strength` from request (default 0.75)
- Use the existing submit → poll → fetch result pattern

#### 2b. Fal Model Catalog Expansion

`listAvailableModels()` updated to 7 entries:

| Model ID | Display Name | Category |
|----------|-------------|----------|
| `fal-ai/flux/dev` | Flux Dev (Fal) | Generation + img2img |
| `fal-ai/flux-pro` | Flux Pro (Fal) | High quality generation |
| `fal-ai/flux/schnell` | Flux Schnell (Fal) | Speed-optimized |
| `fal-ai/flux-pro/v1.1` | Flux Pro 1.1 (Fal) | Latest pro |
| `fal-ai/flux-pro/v1.1-ultra` | Flux Pro 1.1 Ultra (Fal) | Ultra-high resolution |
| `fal-ai/flux-lora` | Flux LoRA (Fal) | LoRA fine-tuned |
| `fal-ai/flux-realism` | Flux Realism (Fal) | Photorealistic output |

### 2c. New `transferStyle()` High-Level API

New file: `src/api/transferStyle.ts`

```typescript
/**
 * @file transferStyle.ts
 * Provider-agnostic style transfer for the AgentOS high-level API.
 *
 * Applies the visual aesthetic of a reference image to a source image,
 * guided by a text prompt. Internally routes to the best available
 * provider for style transfer:
 *
 * - **Replicate** (preferred): Flux Redux — purpose-built for image-guided generation
 * - **Fal**: Flux Dev img2img with style reference in prompt
 * - **Stability**: img2img with strength control
 * - **OpenAI**: editImage with descriptive prompt
 *
 * The API abstracts away provider-specific input formats: callers provide
 * a source image, a style reference image, and a prompt — the routing
 * layer handles model selection and input mapping.
 */

export interface TransferStyleOptions {
  /** Source image to transform (Buffer, file path, URL, or data URI). */
  image: string | Buffer;
  /** Reference image whose visual aesthetic to apply. */
  styleReference: string | Buffer;
  /** Text prompt guiding the transfer direction. */
  prompt: string;
  /**
   * Transfer strength. Controls how much of the reference style to apply.
   * `0.0` = source unchanged, `1.0` = fully adopts reference style.
   * @default 0.7
   */
  strength?: number;
  /** Provider override. Auto-detects from env vars if omitted. */
  provider?: string;
  /** Model override. Provider-specific. */
  model?: string;
  /** Output size (e.g. `'1024x1024'`). */
  size?: string;
  /** Negative prompt describing content to avoid. */
  negativePrompt?: string;
  /** Seed for reproducible output. */
  seed?: number;
  /** Policy tier for provider routing. */
  policyTier?: 'safe' | 'standard' | 'mature' | 'private-adult';
  /** Provider-specific options passthrough. */
  providerOptions?: Record<string, unknown>;
  /** Usage ledger configuration. */
  usageLedger?: AgentOSUsageLedgerOptions;
}

export interface TransferStyleResult {
  /** Generated images with transferred style. */
  images: GeneratedImage[];
  /** Provider that served the request. */
  provider: string;
  /** Model used for the transfer. */
  model: string;
  /** Usage/cost metadata. */
  usage: { costUSD?: number };
}
```

**Provider routing table:**

| Provider | Model | Input Mapping |
|----------|-------|--------------|
| Replicate (default) | `black-forest-labs/flux-redux-dev` | `image` = styleReference (Flux Redux takes the reference as primary input, prompt guides output) |
| Fal (fallback 1) | `fal-ai/flux/dev` | img2img with source as `image`, style ref described in prompt |
| Stability (fallback 2) | `stable-image-core` | img2img with `strength` parameter |
| OpenAI (fallback 3) | `gpt-image-1` | `editImage` with prompt describing target style |

Auto-detection order follows the env-var priority chain. Replicate is preferred when available because Flux Redux is purpose-built for style transfer.

### Files Touched

- **Modify:** `src/media/images/providers/FalImageProvider.ts` — add `editImage()`, expand catalog
- **New:** `src/api/transferStyle.ts` — high-level style transfer API
- **Modify:** `src/api/index.ts` — re-export `transferStyle`
- **New:** `src/media/images/__tests__/FalImageProvider.edit.spec.ts` (~8 tests)
- **New:** `src/media/images/__tests__/FalImageProvider.consistency.spec.ts` (~6 tests)
- **New:** `src/api/runtime/__tests__/transferStyle.test.ts` (~10 tests)

---

## 3. Character Consistency Pipeline

### 3a. Extend `ImageGenerationRequest`

New fields added to `ImageGenerationRequest` in `IImageProvider.ts`:

```typescript
export interface ImageGenerationRequest {
  // ... existing fields ...

  /**
   * Reference image URL or data URI for character/face consistency.
   *
   * Providers that support identity preservation map this to model-specific inputs:
   * - Replicate (Pulid): `main_face_image`
   * - Replicate (Flux Redux): `image`
   * - Fal (IP-Adapter): `ip_adapter_image`
   * - SD-Local: ControlNet with IP-Adapter preprocessor
   * - OpenAI/Stability/OpenRouter/BFL: ignored (debug warning logged)
   */
  referenceImageUrl?: string;

  /**
   * Pre-computed 512-dim face embedding vector for drift detection.
   *
   * When provided alongside `referenceImageUrl`, the AvatarPipeline
   * verifies generated face identity via cosine similarity against
   * this anchor vector.
   */
  faceEmbedding?: number[];

  /**
   * Character consistency mode controlling identity preservation strength.
   *
   * - `'strict'` — Maximum preservation. Uses Pulid/InstantID. Face guaranteed
   *   consistent but output creativity is constrained.
   * - `'balanced'` — Moderate preservation. IP-Adapter strength ~0.6. Good for
   *   expression variants where some variation is acceptable.
   * - `'loose'` — Light guidance. Reference influences mood/style but face may
   *   drift. Good for "inspired by" generations.
   *
   * @default 'balanced'
   */
  consistencyMode?: 'strict' | 'balanced' | 'loose';
}
```

### 3b. Provider Mapping

**Replicate** — in `generateImage()` when `request.referenceImageUrl` or `providerOptions.replicate.referenceImageUrl` is set:

```typescript
// Consistency mode → strength mapping
const CONSISTENCY_STRENGTHS: Record<string, number> = {
  strict: 0.85,
  balanced: 0.6,
  loose: 0.3,
};

// Auto-select model for strict consistency
if (consistencyMode === 'strict' && !request.modelId) {
  modelId = 'zsxkib/pulid';
}

// Map reference image to model-specific input field
if (modelId.includes('pulid')) {
  input.main_face_image = referenceImageUrl;
} else if (modelId.includes('flux-redux')) {
  input.image = referenceImageUrl;
} else {
  // Standard Flux: use image input with strength
  input.image = referenceImageUrl;
  input.image_strength = CONSISTENCY_STRENGTHS[consistencyMode ?? 'balanced'];
}
```

**Fal** — in `generateImage()`:

```typescript
if (referenceImageUrl) {
  body.ip_adapter_image = referenceImageUrl;
  body.ip_adapter_scale = CONSISTENCY_STRENGTHS[consistencyMode ?? 'balanced'];
}
```

**SD-Local** — in `generateImage()`:

```typescript
if (referenceImageUrl) {
  // Inject IP-Adapter via ControlNet extension
  input.alwayson_scripts = {
    ...input.alwayson_scripts,
    controlnet: {
      args: [{
        input_image: referenceImageUrl,
        module: 'ip-adapter_clip_sd15',  // or ip-adapter-plus for higher fidelity
        model: 'ip-adapter_sd15',
        weight: CONSISTENCY_STRENGTHS[consistencyMode ?? 'balanced'],
      }],
    },
  };
}
```

**OpenAI / Stability / OpenRouter / BFL** — graceful no-op:

```typescript
if (referenceImageUrl) {
  console.debug(
    `[${this.providerId}] referenceImageUrl is not natively supported — ` +
    `field ignored. Use Replicate (Pulid), Fal, or SD-Local for character consistency.`
  );
}
```

### 3c. AvatarPipeline Consistency Mode Per Stage

Update `ImageGeneratorFn` signature to accept the new fields:

```typescript
export type ImageGeneratorFn = (
  prompt: string,
  options: {
    seed?: number;
    negativePrompt?: string;
    stylePreset?: string;
    policyTier?: PolicyTier;
    referenceImageUrl?: string;
    faceEmbedding?: number[];
    consistencyMode?: 'strict' | 'balanced' | 'loose';
  },
) => Promise<string>;
```

Stage-specific consistency modes:

| Stage | Consistency Mode | Rationale |
|-------|-----------------|-----------|
| `neutral_portrait` | none (no reference yet) | This IS the anchor |
| `face_embedding` | none (extraction, not generation) | Consumes anchor, produces vector |
| `expression_sheet` | `'strict'` | Facial identity must match across all emotions |
| `animated_emotes` | `'strict'` | Same character in motion |
| `full_body` | `'balanced'` | Body proportions can vary; face should be recognizable |
| `additional_angles` | `'balanced'` | 3/4 and profile views naturally differ from frontal |

### 3d. PolicyAwareImageRouter Capability Update

Add `'character-consistency'` to recognized capabilities:

```typescript
const PROVIDER_CAPABILITIES: Record<string, Set<string>> = {
  replicate: new Set(['character-consistency', 'controlnet', 'style-transfer']),
  fal: new Set(['character-consistency']),
  'stable-diffusion-local': new Set(['character-consistency', 'controlnet']),
  openai: new Set([]),
  stability: new Set([]),
  openrouter: new Set([]),
  bfl: new Set([]),
};
```

`getProviderChain()` filters and reorders based on requested capabilities:

```typescript
getProviderChain(policyTier: PolicyTier, capabilities?: string[]): string[] {
  let chain = this.getBaseChain(policyTier);
  if (capabilities?.length) {
    chain = chain.filter(id =>
      capabilities.every(cap => PROVIDER_CAPABILITIES[id]?.has(cap))
    );
  }
  return chain;
}
```

### Files Touched

- **Modify:** `src/media/images/IImageProvider.ts` — add 3 fields to `ImageGenerationRequest`
- **Modify:** `src/media/images/providers/ReplicateImageProvider.ts` — reference image mapping
- **Modify:** `src/media/images/providers/FalImageProvider.ts` — IP-Adapter mapping
- **Modify:** `src/media/images/providers/StableDiffusionLocalProvider.ts` — ControlNet injection
- **Modify:** `src/media/images/providers/OpenAIImageProvider.ts` — debug warning on ignore
- **Modify:** `src/media/images/providers/OpenRouterImageProvider.ts` — debug warning on ignore
- **Modify:** `src/media/images/providers/FluxImageProvider.ts` — debug warning on ignore
- **Modify:** `src/media/images/providers/StabilityImageProvider.ts` — debug warning on ignore
- **Modify:** `src/media/images/PolicyAwareImageRouter.ts` — capability registry + filtering
- **Modify:** `src/media/avatar/AvatarPipeline.ts` — consistency mode per stage
- **Modify:** `src/media/avatar/types.ts` — update `ImageGeneratorFn` signature
- **Modify:** `src/api/generateImage.ts` — pass through new fields
- **New:** `src/media/images/__tests__/ReplicateImageProvider.consistency.spec.ts` (~8 tests)
- **New:** `src/media/images/__tests__/FalImageProvider.consistency.spec.ts` (~6 tests)
- **New:** `src/media/images/__tests__/StableDiffusionLocalProvider.consistency.spec.ts` (~5 tests)
- **New:** `src/media/avatar/__tests__/AvatarPipeline.consistency.spec.ts` (~8 tests)
- **New:** `src/media/images/__tests__/PolicyAwareImageRouter.consistency.spec.ts` (~4 tests)

---

## 4. Documentation, TSDoc, and Skill Updates

### 4a. TSDoc Enrichment

Every public type, method, interface field, and parameter across the image subsystem gets comprehensive TSDoc with `@param`, `@returns`, `@throws`, `@example` annotations.

**Files requiring TSDoc additions/updates:**

| File | Work |
|------|------|
| `IImageProvider.ts` | Add field-level docs for all interface members. Document new `referenceImageUrl`, `faceEmbedding`, `consistencyMode`. Add `@example` on `ImageGenerationRequest`. |
| `ReplicateImageProvider.ts` | Full TSDoc on every public method. `@example` blocks for Pulid, Flux Redux, ControlNet, standard generation. Document dual-endpoint logic. |
| `FalImageProvider.ts` | TSDoc on new `editImage()`. Update `generateImage()` docs for consistency. |
| `FluxImageProvider.ts` | Add `@example` for each model variant (Pro, Dev, Ultra). |
| `OpenAIImageProvider.ts` | Full TSDoc on `generateImage`, `editImage`, `variateImage`. Document gpt-image-1 vs dall-e-3. |
| `OpenRouterImageProvider.ts` | Full TSDoc with routing examples. |
| `StabilityImageProvider.ts` | Full TSDoc. Document engine routing (core vs ultra vs sd3). |
| `StableDiffusionLocalProvider.ts` | Full TSDoc. Document ControlNet, LoRA, IP-Adapter consistency. |
| `PolicyAwareImageRouter.ts` | Document capability registry and `'character-consistency'` filtering. |
| `AvatarPipeline.ts` | Document consistency mode per stage. Drift guard thresholds. |
| `transferStyle.ts` (new) | Full TSDoc from scratch. |
| `generateImage.ts` (API) | Update for new fields. Provider routing examples. |

**Inline comments** added in:
- Provider auto-detection env-var scanning loop (`generateImage.ts`)
- Model routing decision tree (`ReplicateImageProvider.editImage()`)
- Consistency mode → strength mapping (each provider)
- Dual-endpoint detection logic (Replicate)
- Drift detection regeneration loop (AvatarPipeline)

### 4b. Documentation Rewrites

**Rewrite `docs/features/IMAGE_GENERATION.md`:**
- Provider table: 5 → 7 providers (add BFL, Fal)
- New section: Replicate model catalog (all 13 models with categories)
- New section: Character consistency (`referenceImageUrl`, `consistencyMode`)
- New section: Style transfer (link to `transferStyle()`)
- New section: Fallback chains with `image:fallback` event examples
- New section: Policy-tier routing
- Update all code examples to current API signatures

**Update `docs/features/IMAGE_EDITING.md`:**
- Add Fal to provider matrix
- Add style transfer examples via `transferStyle()`
- Add character consistency in img2img context
- Update capability matrix

**New `docs/features/CHARACTER_CONSISTENCY.md`:**
- `referenceImageUrl`, `faceEmbedding`, `consistencyMode` field reference
- AvatarPipeline usage with drift detection walkthrough
- Provider capability comparison (Pulid vs IP-Adapter vs Flux Redux)
- Code examples for each consistency mode
- When to use each mode (avatars vs scenes vs "inspired by")

**New `docs/features/STYLE_TRANSFER.md`:**
- `transferStyle()` API reference
- Flux Redux workflow explanation
- Aesthetic translation examples (photo→anime, photo→oil painting, realistic→pixel art)
- Provider routing and fallback behavior
- Strength parameter guide with visual examples (described)

### 4c. Skill Update

Update `packages/agentos-skills/registry/curated/image-gen/SKILL.md`:
- Five APIs (add `transferStyle()`)
- Character consistency section in decision tree
- Pulid, Flux Redux, Flux Canny/Depth in model recommendations
- Style transfer examples and prompt guidance
- Updated provider selection guide with consistency capabilities column

### 4d. CHANGELOG

Append to `packages/agentos/CHANGELOG.md`:

```markdown
## [Unreleased]

### Added
- `transferStyle()` high-level API for image-guided style transfer via Flux Redux
- Character consistency fields on `ImageGenerationRequest`: `referenceImageUrl`, `faceEmbedding`, `consistencyMode`
- Replicate: dual-endpoint support (modern `/models/.../predictions` + legacy `/predictions`)
- Replicate: 10 new models in catalog (Flux 1.1 Pro, Ultra, Redux, Canny, Depth, Fill Pro, Pulid, SDXL Lightning, SDXL)
- Replicate: character consistency via Pulid auto-selection when `consistencyMode: 'strict'`
- Replicate: ControlNet image input (`controlImage`, `controlType`) for Flux Canny/Depth
- Fal: `editImage()` support (img2img + inpainting)
- Fal: 4 new models in catalog (Pro 1.1, Ultra, LoRA, Realism)
- Fal: IP-Adapter character consistency mapping
- SD-Local: IP-Adapter character consistency via ControlNet injection
- `PolicyAwareImageRouter`: `'character-consistency'` capability filtering
- `AvatarPipeline`: per-stage consistency mode (`strict` for expressions, `balanced` for body)
- docs/features/CHARACTER_CONSISTENCY.md
- docs/features/STYLE_TRANSFER.md
- 75+ new tests across providers, APIs, and integration scenarios
- Comprehensive TSDoc on all image provider methods and interfaces

### Changed
- Replicate: default inpaint model upgraded from `flux-fill` to `flux-fill-pro`
- docs/features/IMAGE_GENERATION.md: rewritten for 7 providers + new features
- docs/features/IMAGE_EDITING.md: updated provider matrix, added Fal
- image-gen skill: updated for 5 APIs, consistency, style transfer

### Fixed
- OpenAI/Stability/OpenRouter/BFL: graceful debug warning when `referenceImageUrl` is set but unsupported (previously silently ignored with no indication)
```

### Files Touched (Section 4)

- **Modify:** All 12 provider/API files listed in the TSDoc table
- **Rewrite:** `docs/features/IMAGE_GENERATION.md`
- **Update:** `docs/features/IMAGE_EDITING.md`
- **New:** `docs/features/CHARACTER_CONSISTENCY.md`
- **New:** `docs/features/STYLE_TRANSFER.md`
- **Update:** `packages/agentos-skills/registry/curated/image-gen/SKILL.md`
- **Update:** `packages/agentos/CHANGELOG.md`

---

## 5. Test Coverage

### 5a. New Unit Test Files

| File | Tests | Coverage |
|------|-------|---------|
| `ReplicateImageProvider.spec.ts` | ~25 | Generation (old + new endpoint), editImage (flux-fill-pro, SDXL), upscaleImage (Real-ESRGAN), character ref passthrough, ControlNet passthrough, consistency strength mapping, model catalog, errors (429, timeout, cancelled, network) |
| `OpenAIImageProvider.spec.ts` | ~12 | Generation (gpt-image-1, dall-e-3, dall-e-2), editImage, variateImage, size validation, style passthrough, response format, errors (401, 429, 400), referenceImageUrl graceful ignore |
| `FalImageProvider.edit.spec.ts` | ~8 | editImage img2img (strength), inpaint (mask), expanded catalog, errors (submit fail, poll timeout, FAILED) |
| `FalImageProvider.consistency.spec.ts` | ~6 | IP-Adapter passthrough, scale per consistency mode, no-op when absent |
| `StableDiffusionLocalProvider.consistency.spec.ts` | ~5 | ControlNet IP-Adapter injection, weight per consistency mode, LoRA + consistency combined, no-op |
| `ReplicateImageProvider.consistency.spec.ts` | ~8 | Pulid auto-selection on strict, Flux Redux ref mapping, standard Flux image_strength mapping, ControlNet routing by controlType |
| `PolicyAwareImageRouter.consistency.spec.ts` | ~4 | `'character-consistency'` filtering, chain ordering, null for safe tier, uncensored chain |
| `AvatarPipeline.consistency.spec.ts` | ~8 | Consistency mode per stage, faceEmbedding passthrough, drift rejection + regen, existing anchors reuse |
| `transferStyle.test.ts` | ~10 | Replicate Flux Redux routing, Fal fallback, dual-image Buffer conversion, strength mapping, provider auto-detection, policyTier routing, error propagation, usage ledger |

### 5b. Updated Existing Test Files

| File | Changes |
|------|---------|
| `FallbackImageProxy.test.ts` | Fallback when primary ignores referenceImageUrl; transferStyle through proxy |
| `AvatarPipeline.test.ts` | Verify `consistencyMode` + `faceEmbedding` passthrough per stage |
| `generateImage.test.ts` | `referenceImageUrl`, `faceEmbedding`, `consistencyMode` passthrough; capability chain filtering |
| `editImage.test.ts` | Style transfer reference image passthrough |

### 5c. Integration Test

New `src/api/runtime/__tests__/image-pipeline-integration.test.ts` (~5 tests):

1. **Multi-provider fallback:** 3 mock providers, first two fail → verify `image:fallback` events + final success
2. **Policy-tier routing:** `policyTier: 'mature'` → Replicate selected, `disableSafetyChecker` set
3. **Character consistency routing:** `referenceImageUrl` + `consistencyMode: 'strict'` → Pulid auto-selected
4. **Style transfer routing:** `transferStyle` with source + reference → Flux Redux selected, dual images converted
5. **Avatar pipeline + consistency:** Abbreviated pipeline (portrait + expressions) → expression calls include neutral URL as reference with `consistencyMode: 'strict'`

### 5d. E2E Test (Live API, Gated by Env)

New `tests/e2e/image-generation.e2e.spec.ts` (~4 tests):

```typescript
describe.skipIf(!process.env.REPLICATE_API_TOKEN)('Image Generation E2E', () => {
  it('generates via Replicate Flux Schnell', async () => { ... }, 60_000);
  it('transfers style via Flux Redux', async () => { ... }, 60_000);
  it('generates with character ref via Pulid', async () => { ... }, 60_000);
  it('falls back from unavailable provider to Replicate', async () => { ... }, 60_000);
});
```

Gated behind env vars. 60-second timeouts. Asserts structural correctness (non-empty images array, valid URL, correct provider/model metadata), not visual quality.

### Test Count Summary

| Category | New | Updated | Total |
|----------|-----|---------|-------|
| Unit (providers) | ~56 | — | 56 |
| Unit (APIs) | ~10 | — | 10 |
| Unit (pipeline) | ~9 | ~8 | 17 |
| Integration | ~5 | — | 5 |
| E2E (live, gated) | ~4 | — | 4 |
| Existing updates | — | ~12 | 12 |
| **Total** | **~84** | **~20** | **~104** |

---

## Files Summary

### New Files (13)

| File | Purpose |
|------|---------|
| `src/api/transferStyle.ts` | High-level style transfer API |
| `src/media/images/__tests__/ReplicateImageProvider.spec.ts` | Replicate provider unit tests |
| `src/media/images/__tests__/ReplicateImageProvider.consistency.spec.ts` | Replicate consistency tests |
| `src/media/images/__tests__/OpenAIImageProvider.spec.ts` | OpenAI provider unit tests |
| `src/media/images/__tests__/FalImageProvider.edit.spec.ts` | Fal edit/inpaint tests |
| `src/media/images/__tests__/FalImageProvider.consistency.spec.ts` | Fal consistency tests |
| `src/media/images/__tests__/StableDiffusionLocalProvider.consistency.spec.ts` | SD-Local consistency tests |
| `src/media/images/__tests__/PolicyAwareImageRouter.consistency.spec.ts` | Router capability tests |
| `src/media/avatar/__tests__/AvatarPipeline.consistency.spec.ts` | Pipeline consistency tests |
| `src/api/runtime/__tests__/transferStyle.test.ts` | transferStyle API tests |
| `src/api/runtime/__tests__/image-pipeline-integration.test.ts` | Integration tests |
| `docs/features/CHARACTER_CONSISTENCY.md` | Character consistency guide |
| `docs/features/STYLE_TRANSFER.md` | Style transfer guide |

### Modified Files (18)

| File | Change |
|------|--------|
| `src/media/images/IImageProvider.ts` | Add `referenceImageUrl`, `faceEmbedding`, `consistencyMode` to request. TSDoc enrichment. |
| `src/media/images/providers/ReplicateImageProvider.ts` | Dual endpoint, expanded catalog, character ref mapping, ControlNet, TSDoc. |
| `src/media/images/providers/FalImageProvider.ts` | `editImage()`, expanded catalog, IP-Adapter mapping, TSDoc. |
| `src/media/images/providers/OpenAIImageProvider.ts` | Debug warning for unsupported fields. Full TSDoc. |
| `src/media/images/providers/OpenRouterImageProvider.ts` | Debug warning. TSDoc. |
| `src/media/images/providers/StabilityImageProvider.ts` | Debug warning. TSDoc. |
| `src/media/images/providers/FluxImageProvider.ts` | Debug warning. TSDoc. |
| `src/media/images/providers/StableDiffusionLocalProvider.ts` | IP-Adapter ControlNet injection. TSDoc. |
| `src/media/images/PolicyAwareImageRouter.ts` | Capability registry + `'character-consistency'` filtering. |
| `src/media/avatar/AvatarPipeline.ts` | Per-stage consistency mode. Pass faceEmbedding. |
| `src/media/avatar/types.ts` | Update `ImageGeneratorFn` signature. |
| `src/api/generateImage.ts` | Pass through new fields. |
| `src/api/index.ts` | Re-export `transferStyle`. |
| `docs/features/IMAGE_GENERATION.md` | Full rewrite for 7 providers + new features. |
| `docs/features/IMAGE_EDITING.md` | Add Fal, style transfer, consistency. |
| `packages/agentos-skills/registry/curated/image-gen/SKILL.md` | 5 APIs, consistency, style transfer. |
| `packages/agentos/CHANGELOG.md` | Release notes. |
| 4 existing test files | Updates for new fields/features. |

### No Changes Needed

- `FallbackImageProxy.ts` — already handles arbitrary request fields via passthrough
- `imageToBuffer.ts` — already supports all input formats needed
- `ImageOperationError.ts` — existing error types sufficient
- Face embedding service — already complete
- Avatar prompts — already comprehensive

---

## Out of Scope

- ComfyUI workflow API (separate from A1111 SDAPI — different protocol)
- LoRA training pipeline (model fine-tuning is a separate initiative)
- Video generation upgrades (separate subsystem)
- Wilds-AI downstream integration (covered by parasitic-integration-design.md)
- AgentOS npm version bump / publish (done post-merge)
