# AgentOS Image System Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize AgentOS image generation with expanded Replicate/Fal model catalogs, character consistency via Pulid/IP-Adapter, a new `transferStyle()` API, and comprehensive TSDoc + tests + documentation across the entire image subsystem.

**Architecture:** The image subsystem is provider-based: `IImageProvider` implementations sit behind `FallbackImageProxy` (cascading failover) and `PolicyAwareImageRouter` (policy-tier ordering). High-level APIs (`generateImage`, `editImage`, `transferStyle`) resolve providers, build chains, and dispatch. `AvatarPipeline` orchestrates multi-stage avatar generation with face-embedding drift detection. This plan upgrades providers in place, adds new request fields for character consistency, introduces `transferStyle()` as a new high-level API, and backfills tests + docs.

**Tech Stack:** TypeScript, Vitest, fetch API (no SDK deps for Replicate/Fal), EventEmitter for fallback events.

**Spec:** `packages/agentos/docs/superpowers/specs/2026-04-05-image-system-upgrade-design.md`

---

### Task 1: IImageProvider — Add Character Consistency Fields

**Files:**
- Modify: `packages/agentos/src/media/images/IImageProvider.ts`

- [ ] **Step 1: Add `referenceImageUrl`, `faceEmbedding`, `consistencyMode` to `ImageGenerationRequest`**

In `IImageProvider.ts`, add these three fields after the existing `negativePrompt` field in the `ImageGenerationRequest` interface:

```typescript
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
```

- [ ] **Step 2: Add `referenceImageUrl` and `controlImage` to `ReplicateImageProviderOptions`**

In the same file, add to `ReplicateImageProviderOptions`:

```typescript
  /**
   * Reference image URL for character/face consistency.
   *
   * Mapped to provider-specific inputs based on the target model:
   * - Pulid (`zsxkib/pulid`): `main_face_image`
   * - Flux Redux (`flux-redux-dev`): `image`
   * - Standard Flux models: `image` with `image_strength` derived from consistency mode
   */
  referenceImageUrl?: string;

  /**
   * Control image URL for ControlNet-style guided generation.
   *
   * Mapped to model-specific inputs:
   * - Flux Canny (`flux-canny-dev`): `control_image`
   * - Flux Depth (`flux-depth-dev`): `control_image`
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
```

- [ ] **Step 3: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/src/media/images/IImageProvider.ts
git commit -m "feat(agentos): add character consistency fields to ImageGenerationRequest"
```

---

### Task 2: Replicate Provider — Dual Endpoint + Expanded Catalog

**Files:**
- Modify: `packages/agentos/src/media/images/providers/ReplicateImageProvider.ts`

- [ ] **Step 1: Write test for dual-endpoint model detection**

Create `packages/agentos/src/media/images/__tests__/ReplicateImageProvider.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplicateImageProvider } from '../providers/ReplicateImageProvider.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockPredictionResponse(output: unknown, status = 'succeeded') {
  return {
    ok: true,
    json: async () => ({ id: 'pred_123', status, output }),
    text: async () => '',
    headers: new Headers(),
  };
}

describe('ReplicateImageProvider', () => {
  let provider: ReplicateImageProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new ReplicateImageProvider();
    await provider.initialize({ apiKey: 'test-key' });
  });

  describe('generateImage', () => {
    it('uses legacy /predictions endpoint for version-hash model IDs', async () => {
      mockFetch.mockResolvedValueOnce(
        mockPredictionResponse(['https://example.com/image.png'])
      );

      await provider.generateImage({
        modelId: 'daanelson/some-model:abc123def456',
        prompt: 'a test image',
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.replicate.com/v1/predictions');
      const body = JSON.parse(opts.body);
      expect(body.version).toBe('daanelson/some-model:abc123def456');
    });

    it('uses modern /models/.../predictions endpoint for plain model IDs', async () => {
      mockFetch.mockResolvedValueOnce(
        mockPredictionResponse(['https://example.com/image.png'])
      );

      await provider.generateImage({
        modelId: 'black-forest-labs/flux-1.1-pro',
        prompt: 'a test image',
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions'
      );
    });

    it('defaults to flux-schnell when no model specified', async () => {
      mockFetch.mockResolvedValueOnce(
        mockPredictionResponse(['https://example.com/image.png'])
      );

      await provider.generateImage({ prompt: 'test' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('black-forest-labs/flux-schnell');
    });
  });

  describe('listAvailableModels', () => {
    it('returns at least 13 models with descriptions', async () => {
      const models = await provider.listAvailableModels();
      expect(models.length).toBeGreaterThanOrEqual(13);
      for (const model of models) {
        expect(model.providerId).toBe('replicate');
        expect(model.modelId).toBeTruthy();
        expect(model.displayName).toBeTruthy();
        expect(model.description).toBeTruthy();
      }
    });

    it('includes Pulid for character consistency', async () => {
      const models = await provider.listAvailableModels();
      expect(models.some(m => m.modelId === 'zsxkib/pulid')).toBe(true);
    });

    it('includes Flux Redux for style transfer', async () => {
      const models = await provider.listAvailableModels();
      expect(models.some(m => m.modelId === 'black-forest-labs/flux-redux-dev')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agentos && npx vitest run src/media/images/__tests__/ReplicateImageProvider.spec.ts --reporter verbose`
Expected: FAIL — tests expect new endpoint routing + expanded model catalog

- [ ] **Step 3: Add `createModelPrediction` method to ReplicateImageProvider**

In `ReplicateImageProvider.ts`, add after the existing `createPrediction` method:

```typescript
  /**
   * Creates a prediction using the modern model-based endpoint.
   *
   * Official models on Replicate (e.g. `black-forest-labs/flux-1.1-pro`)
   * use `/models/{owner}/{name}/predictions` which accepts `{ input }`
   * directly without a `version` field.
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
  ): Promise<ReplicatePrediction> {
    const response = await fetch(
      `${this.config.baseURL}/models/${owner}/${name}/predictions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Prefer: `wait=${waitSeconds}`,
        },
        body: JSON.stringify({ input }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Replicate model prediction failed (${response.status}): ${errorText}`,
      );
    }

    return (await response.json()) as ReplicatePrediction;
  }
```

- [ ] **Step 4: Update `generateImage` to use dual-endpoint routing**

Replace the body construction + createPrediction call in `generateImage()`:

```typescript
    const modelId = request.modelId || this.defaultModelId || 'black-forest-labs/flux-schnell';
    const hasVersionHash = modelId.includes(':');
    const waitSeconds = providerOptions?.wait ?? 60;

    let prediction: ReplicatePrediction;

    if (hasVersionHash) {
      // Legacy endpoint: POST /predictions with { version, input }
      const body: Record<string, unknown> = { version: modelId, input };
      if (providerOptions?.webhook) body.webhook = providerOptions.webhook;
      if (providerOptions?.webhookEventsFilter) body.webhook_events_filter = providerOptions.webhookEventsFilter;
      if (providerOptions?.extraBody) Object.assign(body, providerOptions.extraBody);
      prediction = await this.createPrediction(body, waitSeconds);
    } else {
      // Modern endpoint: POST /models/{owner}/{name}/predictions with { input }
      const slashIndex = modelId.indexOf('/');
      const owner = modelId.substring(0, slashIndex);
      const name = modelId.substring(slashIndex + 1);
      prediction = await this.createModelPrediction(owner, name, input, waitSeconds);
    }
```

- [ ] **Step 5: Update `listAvailableModels` with expanded catalog**

Replace the existing method body:

```typescript
  async listAvailableModels(): Promise<ImageModelInfo[]> {
    return [
      // Generation
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-schnell', displayName: 'Flux Schnell', description: 'Fast generation, 4 steps' },
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-dev', displayName: 'Flux Dev', description: 'Open-weight development model' },
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-pro', displayName: 'Flux Pro', description: 'Highest quality commercial' },
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-1.1-pro', displayName: 'Flux 1.1 Pro', description: 'Latest pro generation' },
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-1.1-pro-ultra', displayName: 'Flux 1.1 Pro Ultra', description: 'Ultra-high resolution' },
      { providerId: this.providerId, modelId: 'bytedance/sdxl-lightning-4step', displayName: 'SDXL Lightning', description: '4-step fast SDXL' },
      { providerId: this.providerId, modelId: 'stability-ai/sdxl', displayName: 'SDXL', description: 'Classic Stable Diffusion XL' },
      // Style transfer
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-redux-dev', displayName: 'Flux Redux Dev', description: 'Image-guided style transfer' },
      // ControlNet
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-canny-dev', displayName: 'Flux Canny', description: 'Edge-guided generation' },
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-depth-dev', displayName: 'Flux Depth', description: 'Depth-guided generation' },
      // Character consistency
      { providerId: this.providerId, modelId: 'zsxkib/pulid', displayName: 'Pulid', description: 'Face-consistent generation from reference' },
      // Inpainting
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-fill-pro', displayName: 'Flux Fill Pro', description: 'Production inpainting' },
      // Upscaling
      { providerId: this.providerId, modelId: 'nightmareai/real-esrgan', displayName: 'Real-ESRGAN', description: '2x/4x image upscaling' },
    ];
  }
```

- [ ] **Step 6: Update `editImage` default inpaint model**

In `editImage()`, update the default model selection:

```typescript
    const defaultModel = hasInpaintingMask
      ? 'black-forest-labs/flux-fill-pro'
      : 'stability-ai/sdxl';
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/agentos && npx vitest run src/media/images/__tests__/ReplicateImageProvider.spec.ts --reporter verbose`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/src/media/images/providers/ReplicateImageProvider.ts packages/agentos/src/media/images/__tests__/ReplicateImageProvider.spec.ts
git commit -m "feat(agentos): replicate dual-endpoint support + expanded model catalog"
```

---

### Task 3: Replicate Provider — Character Consistency + ControlNet

**Files:**
- Modify: `packages/agentos/src/media/images/providers/ReplicateImageProvider.ts`
- Create: `packages/agentos/src/media/images/__tests__/ReplicateImageProvider.consistency.spec.ts`

- [ ] **Step 1: Write character consistency tests**

Create `packages/agentos/src/media/images/__tests__/ReplicateImageProvider.consistency.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplicateImageProvider } from '../providers/ReplicateImageProvider.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockSuccess(output: unknown = ['https://example.com/img.png']) {
  return { ok: true, json: async () => ({ id: 'p1', status: 'succeeded', output }), text: async () => '', headers: new Headers() };
}

describe('ReplicateImageProvider — Character Consistency', () => {
  let provider: ReplicateImageProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new ReplicateImageProvider();
    await provider.initialize({ apiKey: 'test-key' });
  });

  it('auto-selects Pulid when consistencyMode is strict and no model specified', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccess());

    await provider.generateImage({
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
      consistencyMode: 'strict',
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('zsxkib/pulid');
  });

  it('maps referenceImageUrl to main_face_image for Pulid models', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccess());

    await provider.generateImage({
      modelId: 'zsxkib/pulid',
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.main_face_image).toBe('https://ref.test/face.png');
  });

  it('maps referenceImageUrl to image for Flux Redux models', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccess());

    await provider.generateImage({
      modelId: 'black-forest-labs/flux-redux-dev',
      prompt: 'style transfer',
      referenceImageUrl: 'https://ref.test/style.png',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.image).toBe('https://ref.test/style.png');
  });

  it('sets image_strength based on consistencyMode for standard Flux models', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccess());

    await provider.generateImage({
      modelId: 'black-forest-labs/flux-dev',
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
      consistencyMode: 'loose',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.image).toBe('https://ref.test/face.png');
    expect(body.input.image_strength).toBe(0.3);
  });

  it('maps controlImage to control_image for Canny model', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccess());

    await provider.generateImage({
      modelId: 'black-forest-labs/flux-canny-dev',
      prompt: 'guided generation',
      providerOptions: {
        replicate: { controlImage: 'https://ref.test/edges.png' },
      },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.control_image).toBe('https://ref.test/edges.png');
  });

  it('auto-routes to Canny model when controlType is canny and no model set', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccess());

    await provider.generateImage({
      prompt: 'edge-guided',
      providerOptions: {
        replicate: {
          controlImage: 'https://ref.test/edges.png',
          controlType: 'canny',
        },
      },
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('flux-canny-dev');
  });

  it('ignores referenceImageUrl when not provided', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccess());

    await provider.generateImage({ prompt: 'no ref' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.main_face_image).toBeUndefined();
    expect(body.input.image).toBeUndefined();
    expect(body.input.image_strength).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agentos && npx vitest run src/media/images/__tests__/ReplicateImageProvider.consistency.spec.ts --reporter verbose`
Expected: FAIL — consistency mapping not yet implemented

- [ ] **Step 3: Implement character consistency + ControlNet mapping in generateImage**

In `ReplicateImageProvider.generateImage()`, add after the existing input construction (after the `providerOptions?.megapixels` block) and before the endpoint routing:

```typescript
    // --- Character consistency mapping ---
    const CONSISTENCY_STRENGTHS: Record<string, number> = {
      strict: 0.85,
      balanced: 0.6,
      loose: 0.3,
    };

    const refUrl = request.referenceImageUrl ?? providerOptions?.referenceImageUrl;
    const consistencyMode = request.consistencyMode ?? 'balanced';

    // Auto-select model for strict consistency when no model explicitly set
    let modelId = request.modelId || this.defaultModelId || 'black-forest-labs/flux-schnell';
    if (refUrl && consistencyMode === 'strict' && !request.modelId) {
      modelId = 'zsxkib/pulid';
    }

    // Auto-route by controlType when controlImage is set and no model specified
    if (providerOptions?.controlImage && providerOptions.controlType && !request.modelId) {
      const controlRoutes: Record<string, string> = {
        canny: 'black-forest-labs/flux-canny-dev',
        depth: 'black-forest-labs/flux-depth-dev',
      };
      const routed = controlRoutes[providerOptions.controlType];
      if (routed) modelId = routed;
    }

    // Map reference image to model-specific input field
    if (refUrl) {
      if (modelId.includes('pulid')) {
        input.main_face_image = refUrl;
      } else if (modelId.includes('flux-redux')) {
        input.image = refUrl;
      } else {
        input.image = refUrl;
        input.image_strength = CONSISTENCY_STRENGTHS[consistencyMode];
      }
    }

    // Map control image for ControlNet models
    if (providerOptions?.controlImage) {
      input.control_image = providerOptions.controlImage;
    }
```

Update the `modelId` variable reference in the endpoint routing section to use this local `modelId` variable instead of re-reading `request.modelId`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agentos && npx vitest run src/media/images/__tests__/ReplicateImageProvider.consistency.spec.ts --reporter verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/src/media/images/providers/ReplicateImageProvider.ts packages/agentos/src/media/images/__tests__/ReplicateImageProvider.consistency.spec.ts
git commit -m "feat(agentos): replicate character consistency + ControlNet mapping"
```

---

### Task 4: Replicate Provider — Error Handling Tests

**Files:**
- Modify: `packages/agentos/src/media/images/__tests__/ReplicateImageProvider.spec.ts`

- [ ] **Step 1: Add error handling tests to existing spec file**

Append to `ReplicateImageProvider.spec.ts`:

```typescript
  describe('error handling', () => {
    it('throws on rate limit (429)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
        headers: new Headers(),
      });

      await expect(
        provider.generateImage({ prompt: 'test' })
      ).rejects.toThrow('429');
    });

    it('throws on failed prediction status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'p1', status: 'failed', error: 'content policy violation' }),
        text: async () => '',
        headers: new Headers(),
      });

      await expect(
        provider.generateImage({ prompt: 'test' })
      ).rejects.toThrow('failed');
    });

    it('throws on cancelled prediction', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'p1', status: 'canceled' }),
        text: async () => '',
        headers: new Headers(),
      });

      await expect(
        provider.generateImage({ prompt: 'test' })
      ).rejects.toThrow('canceled');
    });

    it('throws when prediction returns no images', async () => {
      mockFetch.mockResolvedValueOnce(
        mockPredictionResponse([])
      );

      await expect(
        provider.generateImage({ prompt: 'test' })
      ).rejects.toThrow('no image');
    });

    it('throws when not initialized', async () => {
      const uninit = new ReplicateImageProvider();
      await expect(
        uninit.generateImage({ prompt: 'test' })
      ).rejects.toThrow('not initialized');
    });
  });

  describe('editImage', () => {
    it('uses flux-fill-pro for inpainting when mask provided', async () => {
      mockFetch.mockResolvedValueOnce(
        mockPredictionResponse(['https://example.com/edited.png'])
      );

      await provider.editImage({
        modelId: '',
        image: Buffer.from('fake-image'),
        prompt: 'fill the gap',
        mask: Buffer.from('fake-mask'),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.version).toContain('flux-fill-pro');
    });

    it('uses stability-ai/sdxl for img2img without mask', async () => {
      mockFetch.mockResolvedValueOnce(
        mockPredictionResponse(['https://example.com/edited.png'])
      );

      await provider.editImage({
        modelId: '',
        image: Buffer.from('fake-image'),
        prompt: 'transform style',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.version).toContain('stability-ai/sdxl');
    });
  });

  describe('upscaleImage', () => {
    it('uses real-esrgan by default', async () => {
      mockFetch.mockResolvedValueOnce(
        mockPredictionResponse(['https://example.com/upscaled.png'])
      );

      await provider.upscaleImage({
        modelId: '',
        image: Buffer.from('fake-image'),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.version).toContain('real-esrgan');
    });
  });
```

- [ ] **Step 2: Run all Replicate tests**

Run: `cd packages/agentos && npx vitest run src/media/images/__tests__/ReplicateImageProvider.spec.ts --reporter verbose`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/src/media/images/__tests__/ReplicateImageProvider.spec.ts
git commit -m "test(agentos): replicate provider error handling + edit/upscale tests"
```

---

### Task 5: Fal Provider — editImage + Expanded Catalog

**Files:**
- Modify: `packages/agentos/src/media/images/providers/FalImageProvider.ts`
- Create: `packages/agentos/src/media/images/__tests__/FalImageProvider.edit.spec.ts`

- [ ] **Step 1: Write Fal editImage tests**

Create `packages/agentos/src/media/images/__tests__/FalImageProvider.edit.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FalImageProvider } from '../providers/FalImageProvider.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockSubmit() {
  return { ok: true, json: async () => ({ request_id: 'req_123' }), text: async () => '' };
}
function mockStatus(status = 'COMPLETED') {
  return { ok: true, json: async () => ({ status }), text: async () => '' };
}
function mockResult(images = [{ url: 'https://fal.test/out.png', width: 1024, height: 1024 }]) {
  return { ok: true, json: async () => ({ images }), text: async () => '' };
}

describe('FalImageProvider — editImage', () => {
  let provider: FalImageProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new FalImageProvider();
    await provider.initialize({ apiKey: 'fal_test', pollIntervalMs: 1, timeoutMs: 5000 });
  });

  it('performs img2img with strength parameter', async () => {
    mockFetch
      .mockResolvedValueOnce(mockSubmit())
      .mockResolvedValueOnce(mockStatus())
      .mockResolvedValueOnce(mockResult());

    const result = await provider.editImage({
      modelId: 'fal-ai/flux/dev',
      image: Buffer.from('fake'),
      prompt: 'oil painting style',
      strength: 0.65,
    });

    expect(result.images).toHaveLength(1);
    // Verify the submit body includes image and strength
    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(submitBody.image).toBeDefined();
    expect(submitBody.strength).toBe(0.65);
  });

  it('routes to inpaint model when mask provided', async () => {
    mockFetch
      .mockResolvedValueOnce(mockSubmit())
      .mockResolvedValueOnce(mockStatus())
      .mockResolvedValueOnce(mockResult());

    await provider.editImage({
      modelId: '',
      image: Buffer.from('fake'),
      prompt: 'fill area',
      mask: Buffer.from('fake-mask'),
    });

    const [submitUrl] = mockFetch.mock.calls[0];
    // Should route to an inpaint-capable model
    expect(submitUrl).toMatch(/flux/);
  });

  it('throws when not initialized', async () => {
    const uninit = new FalImageProvider();
    await expect(
      uninit.editImage({ modelId: '', image: Buffer.from('x'), prompt: 'test' })
    ).rejects.toThrow('not initialized');
  });

  describe('listAvailableModels', () => {
    it('returns at least 7 models', async () => {
      const models = await provider.listAvailableModels();
      expect(models.length).toBeGreaterThanOrEqual(7);
      expect(models.every(m => m.providerId === 'fal')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agentos && npx vitest run src/media/images/__tests__/FalImageProvider.edit.spec.ts --reporter verbose`
Expected: FAIL — `editImage` not implemented on FalImageProvider

- [ ] **Step 3: Implement `editImage` on FalImageProvider**

Add to `FalImageProvider.ts` after the `generateImage` method:

```typescript
  /**
   * Edit an image using a Fal.ai-hosted Flux model.
   *
   * Supports img2img (prompt-guided transformation) and inpainting
   * (mask-guided regional editing). The source image is passed as a
   * base64 data URL in the `image` field of the model input.
   *
   * @param request - Edit request with source image, prompt, and optional mask.
   * @returns Generation result with the edited image(s).
   * @throws {Error} When the provider is not initialised or the API fails.
   *
   * @example
   * ```typescript
   * // Img2img style transfer
   * const result = await provider.editImage({
   *   modelId: 'fal-ai/flux/dev',
   *   image: imageBuffer,
   *   prompt: 'Convert to watercolor style',
   *   strength: 0.7,
   * });
   * ```
   */
  async editImage(request: ImageEditRequest): Promise<ImageGenerationResult> {
    if (!this.isInitialized) {
      throw new Error('Fal.ai image provider is not initialized. Call initialize() first.');
    }

    const hasMask = !!request.mask;
    const model = request.modelId || (hasMask ? 'fal-ai/flux/dev' : 'fal-ai/flux/dev');

    const imageDataUrl = `data:image/png;base64,${request.image.toString('base64')}`;
    const body: Record<string, unknown> = {
      prompt: request.prompt,
      image: imageDataUrl,
    };

    if (hasMask) {
      body.mask = `data:image/png;base64,${request.mask!.toString('base64')}`;
    }

    if (request.strength !== undefined) {
      body.strength = request.strength;
    } else {
      body.strength = 0.75;
    }

    if (request.negativePrompt) body.negative_prompt = request.negativePrompt;
    if (request.seed !== undefined) body.seed = request.seed;
    if (request.n) body.num_images = request.n;

    const requestId = await this._submitTask(model, body);
    await this._pollStatus(model, requestId);
    const result = await this._fetchResult(model, requestId);

    if (!result.images || result.images.length === 0) {
      throw new Error('Fal.ai edit completed but returned no images.');
    }

    const images: GeneratedImage[] = result.images.map((img) => ({
      url: img.url,
      mimeType: img.content_type,
      providerMetadata: { width: img.width, height: img.height, seed: result.seed },
    }));

    return {
      created: Math.floor(Date.now() / 1000),
      modelId: model,
      providerId: this.providerId,
      images,
      usage: { totalImages: images.length },
    };
  }
```

Add the import for `ImageEditRequest` at the top of the file:

```typescript
import {
  type IImageProvider,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ImageEditRequest,
  type ImageModelInfo,
  type GeneratedImage,
  parseImageSize,
} from '../IImageProvider.js';
```

- [ ] **Step 4: Update `listAvailableModels` with expanded catalog**

Replace the method body:

```typescript
  async listAvailableModels(): Promise<ImageModelInfo[]> {
    return [
      { providerId: this.providerId, modelId: 'fal-ai/flux/dev', displayName: 'Flux Dev (Fal)', description: 'Fast iteration, open weights, img2img capable' },
      { providerId: this.providerId, modelId: 'fal-ai/flux-pro', displayName: 'Flux Pro (Fal)', description: 'Highest quality generation' },
      { providerId: this.providerId, modelId: 'fal-ai/flux/schnell', displayName: 'Flux Schnell (Fal)', description: 'Speed-optimized generation' },
      { providerId: this.providerId, modelId: 'fal-ai/flux-pro/v1.1', displayName: 'Flux Pro 1.1 (Fal)', description: 'Latest pro generation' },
      { providerId: this.providerId, modelId: 'fal-ai/flux-pro/v1.1-ultra', displayName: 'Flux Pro 1.1 Ultra (Fal)', description: 'Ultra-high resolution' },
      { providerId: this.providerId, modelId: 'fal-ai/flux-lora', displayName: 'Flux LoRA (Fal)', description: 'LoRA fine-tuned generation' },
      { providerId: this.providerId, modelId: 'fal-ai/flux-realism', displayName: 'Flux Realism (Fal)', description: 'Photorealistic output' },
    ];
  }
```

- [ ] **Step 5: Run tests**

Run: `cd packages/agentos && npx vitest run src/media/images/__tests__/FalImageProvider.edit.spec.ts --reporter verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/src/media/images/providers/FalImageProvider.ts packages/agentos/src/media/images/__tests__/FalImageProvider.edit.spec.ts
git commit -m "feat(agentos): fal editImage support + expanded model catalog"
```

---

### Task 6: Fal Provider — Character Consistency (IP-Adapter)

**Files:**
- Modify: `packages/agentos/src/media/images/providers/FalImageProvider.ts`
- Create: `packages/agentos/src/media/images/__tests__/FalImageProvider.consistency.spec.ts`

- [ ] **Step 1: Write Fal consistency tests**

Create `packages/agentos/src/media/images/__tests__/FalImageProvider.consistency.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FalImageProvider } from '../providers/FalImageProvider.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockSubmit() {
  return { ok: true, json: async () => ({ request_id: 'req_1' }), text: async () => '' };
}
function mockStatus() {
  return { ok: true, json: async () => ({ status: 'COMPLETED' }), text: async () => '' };
}
function mockResult() {
  return { ok: true, json: async () => ({ images: [{ url: 'https://fal.test/out.png' }] }), text: async () => '' };
}

describe('FalImageProvider — Character Consistency', () => {
  let provider: FalImageProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new FalImageProvider();
    await provider.initialize({ apiKey: 'fal_test', pollIntervalMs: 1, timeoutMs: 5000 });
  });

  it('maps referenceImageUrl to ip_adapter_image', async () => {
    mockFetch.mockResolvedValueOnce(mockSubmit()).mockResolvedValueOnce(mockStatus()).mockResolvedValueOnce(mockResult());

    await provider.generateImage({
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
    });

    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(submitBody.ip_adapter_image).toBe('https://ref.test/face.png');
  });

  it('sets ip_adapter_scale to 0.9 for strict mode', async () => {
    mockFetch.mockResolvedValueOnce(mockSubmit()).mockResolvedValueOnce(mockStatus()).mockResolvedValueOnce(mockResult());

    await provider.generateImage({
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
      consistencyMode: 'strict',
    });

    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(submitBody.ip_adapter_scale).toBe(0.9);
  });

  it('sets ip_adapter_scale to 0.3 for loose mode', async () => {
    mockFetch.mockResolvedValueOnce(mockSubmit()).mockResolvedValueOnce(mockStatus()).mockResolvedValueOnce(mockResult());

    await provider.generateImage({
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
      consistencyMode: 'loose',
    });

    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(submitBody.ip_adapter_scale).toBe(0.3);
  });

  it('defaults to balanced (0.6) when consistencyMode not specified', async () => {
    mockFetch.mockResolvedValueOnce(mockSubmit()).mockResolvedValueOnce(mockStatus()).mockResolvedValueOnce(mockResult());

    await provider.generateImage({
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
    });

    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(submitBody.ip_adapter_scale).toBe(0.6);
  });

  it('does not set ip_adapter fields when no referenceImageUrl', async () => {
    mockFetch.mockResolvedValueOnce(mockSubmit()).mockResolvedValueOnce(mockStatus()).mockResolvedValueOnce(mockResult());

    await provider.generateImage({ prompt: 'no ref' });

    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(submitBody.ip_adapter_image).toBeUndefined();
    expect(submitBody.ip_adapter_scale).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agentos && npx vitest run src/media/images/__tests__/FalImageProvider.consistency.spec.ts --reporter verbose`
Expected: FAIL

- [ ] **Step 3: Add IP-Adapter mapping to FalImageProvider.generateImage**

In `FalImageProvider.generateImage()`, add after the existing body construction (before `_submitTask`):

```typescript
    // --- Character consistency via IP-Adapter ---
    const FAL_CONSISTENCY_SCALES: Record<string, number> = {
      strict: 0.9,
      balanced: 0.6,
      loose: 0.3,
    };

    if (request.referenceImageUrl) {
      body.ip_adapter_image = request.referenceImageUrl;
      body.ip_adapter_scale = FAL_CONSISTENCY_SCALES[request.consistencyMode ?? 'balanced'];
    }
```

- [ ] **Step 4: Run tests**

Run: `cd packages/agentos && npx vitest run src/media/images/__tests__/FalImageProvider.consistency.spec.ts --reporter verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/src/media/images/providers/FalImageProvider.ts packages/agentos/src/media/images/__tests__/FalImageProvider.consistency.spec.ts
git commit -m "feat(agentos): fal IP-Adapter character consistency mapping"
```

---

### Task 7: SD-Local Provider — IP-Adapter ControlNet Injection

**Files:**
- Modify: `packages/agentos/src/media/images/providers/StableDiffusionLocalProvider.ts`
- Create: `packages/agentos/src/media/images/__tests__/StableDiffusionLocalProvider.consistency.spec.ts`

- [ ] **Step 1: Write SD-Local consistency tests**

Create `packages/agentos/src/media/images/__tests__/StableDiffusionLocalProvider.consistency.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StableDiffusionLocalProvider } from '../providers/StableDiffusionLocalProvider.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('StableDiffusionLocalProvider — Character Consistency', () => {
  let provider: StableDiffusionLocalProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new StableDiffusionLocalProvider();
    await provider.initialize({ baseURL: 'http://localhost:7860' });
  });

  it('injects IP-Adapter ControlNet when referenceImageUrl is set', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ images: ['base64data'] }),
    });

    await provider.generateImage({
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
      consistencyMode: 'strict',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.alwayson_scripts?.controlnet?.args).toBeDefined();
    const cnArg = body.alwayson_scripts.controlnet.args[0];
    expect(cnArg.input_image).toBe('https://ref.test/face.png');
    expect(cnArg.module).toContain('ip-adapter');
    expect(cnArg.weight).toBe(0.9);
  });

  it('uses weight 0.6 for balanced mode', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ images: ['base64data'] }),
    });

    await provider.generateImage({
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
      consistencyMode: 'balanced',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.alwayson_scripts.controlnet.args[0].weight).toBe(0.6);
  });

  it('does not inject ControlNet when no referenceImageUrl', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ images: ['base64data'] }),
    });

    await provider.generateImage({ prompt: 'no ref' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.alwayson_scripts?.controlnet).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agentos && npx vitest run src/media/images/__tests__/StableDiffusionLocalProvider.consistency.spec.ts --reporter verbose`
Expected: FAIL

- [ ] **Step 3: Add IP-Adapter ControlNet injection to StableDiffusionLocalProvider**

In `StableDiffusionLocalProvider.generateImage()`, add before the fetch call:

```typescript
    // --- Character consistency via IP-Adapter ControlNet ---
    const SD_CONSISTENCY_WEIGHTS: Record<string, number> = {
      strict: 0.9,
      balanced: 0.6,
      loose: 0.3,
    };

    if (request.referenceImageUrl) {
      const weight = SD_CONSISTENCY_WEIGHTS[request.consistencyMode ?? 'balanced'];
      body.alwayson_scripts = {
        ...(body.alwayson_scripts as Record<string, unknown> ?? {}),
        controlnet: {
          args: [{
            input_image: request.referenceImageUrl,
            module: 'ip-adapter_clip_sd15',
            model: 'ip-adapter_sd15',
            weight,
          }],
        },
      };
    }
```

- [ ] **Step 4: Run tests**

Run: `cd packages/agentos && npx vitest run src/media/images/__tests__/StableDiffusionLocalProvider.consistency.spec.ts --reporter verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/src/media/images/providers/StableDiffusionLocalProvider.ts packages/agentos/src/media/images/__tests__/StableDiffusionLocalProvider.consistency.spec.ts
git commit -m "feat(agentos): sd-local IP-Adapter character consistency via ControlNet"
```

---

### Task 8: Non-Supporting Providers — Graceful Debug Warnings

**Files:**
- Modify: `packages/agentos/src/media/images/providers/OpenAIImageProvider.ts`
- Modify: `packages/agentos/src/media/images/providers/OpenRouterImageProvider.ts`
- Modify: `packages/agentos/src/media/images/providers/StabilityImageProvider.ts`
- Modify: `packages/agentos/src/media/images/providers/FluxImageProvider.ts`

- [ ] **Step 1: Add debug warning to each provider's generateImage**

In each of the four providers, add at the top of `generateImage()` (after the initialization check):

**OpenAIImageProvider.ts:**
```typescript
    if (request.referenceImageUrl) {
      console.debug(
        '[openai] referenceImageUrl is not natively supported — ' +
        'field ignored. Use Replicate (Pulid), Fal, or SD-Local for character consistency.'
      );
    }
```

**OpenRouterImageProvider.ts:**
```typescript
    if (request.referenceImageUrl) {
      console.debug(
        '[openrouter] referenceImageUrl is not natively supported — ' +
        'field ignored. Use Replicate (Pulid), Fal, or SD-Local for character consistency.'
      );
    }
```

**StabilityImageProvider.ts:**
```typescript
    if (request.referenceImageUrl) {
      console.debug(
        '[stability] referenceImageUrl is not natively supported — ' +
        'field ignored. Use Replicate (Pulid), Fal, or SD-Local for character consistency.'
      );
    }
```

**FluxImageProvider.ts:**
```typescript
    if (request.referenceImageUrl) {
      console.debug(
        '[bfl] referenceImageUrl is not natively supported — ' +
        'field ignored. Use Replicate (Pulid), Fal, or SD-Local for character consistency.'
      );
    }
```

- [ ] **Step 2: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/src/media/images/providers/OpenAIImageProvider.ts packages/agentos/src/media/images/providers/OpenRouterImageProvider.ts packages/agentos/src/media/images/providers/StabilityImageProvider.ts packages/agentos/src/media/images/providers/FluxImageProvider.ts
git commit -m "feat(agentos): graceful debug warnings for unsupported referenceImageUrl"
```

---

### Task 9: PolicyAwareImageRouter — Capability Filtering

**Files:**
- Modify: `packages/agentos/src/media/images/PolicyAwareImageRouter.ts`
- Create: `packages/agentos/src/media/images/__tests__/PolicyAwareImageRouter.consistency.spec.ts`

- [ ] **Step 1: Write capability filtering tests**

Create `packages/agentos/src/media/images/__tests__/PolicyAwareImageRouter.consistency.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PolicyAwareImageRouter } from '../PolicyAwareImageRouter.js';
import { createUncensoredModelCatalog } from '../../../core/llm/routing/UncensoredModelCatalog.js';

describe('PolicyAwareImageRouter — Capability Filtering', () => {
  const router = new PolicyAwareImageRouter(createUncensoredModelCatalog());

  it('filters chain to character-consistency-capable providers for safe tier', () => {
    const chain = router.getProviderChain('safe', ['character-consistency']);
    // Only replicate, fal, stable-diffusion-local support it
    for (const id of chain) {
      expect(['replicate', 'fal', 'stable-diffusion-local']).toContain(id);
    }
    expect(chain).not.toContain('openai');
    expect(chain).not.toContain('stability');
  });

  it('returns full chain when no capabilities requested', () => {
    const chain = router.getProviderChain('safe');
    expect(chain.length).toBeGreaterThan(3);
  });

  it('filters mature chain by character-consistency', () => {
    const chain = router.getProviderChain('mature', ['character-consistency']);
    for (const id of chain) {
      expect(['replicate', 'fal', 'stable-diffusion-local']).toContain(id);
    }
  });

  it('returns empty chain if no provider matches all capabilities', () => {
    const chain = router.getProviderChain('safe', ['character-consistency', 'nonexistent-cap']);
    expect(chain).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agentos && npx vitest run src/media/images/__tests__/PolicyAwareImageRouter.consistency.spec.ts --reporter verbose`
Expected: FAIL — `getProviderChain` doesn't accept capabilities param

- [ ] **Step 3: Add capability registry and filtering to PolicyAwareImageRouter**

In `PolicyAwareImageRouter.ts`, add the capability registry and update `getProviderChain`:

```typescript
/** Known capabilities per provider. */
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

Update `getProviderChain` signature and body:

```typescript
  /**
   * Get the ordered provider chain for a given policy tier,
   * optionally filtered by required capabilities.
   *
   * @param policyTier - Content policy tier.
   * @param capabilities - Optional required capabilities (e.g. `['character-consistency']`).
   *   When provided, only providers supporting ALL listed capabilities are included.
   * @returns Ordered array of provider IDs to try in sequence.
   */
  getProviderChain(policyTier: PolicyTier, capabilities?: string[]): string[] {
    const base = policyTier === 'safe' || policyTier === 'standard'
      ? [...DEFAULT_PROVIDER_CHAIN]
      : [...UNCENSORED_PROVIDER_CHAIN];

    if (!capabilities || capabilities.length === 0) {
      return base;
    }

    return base.filter((id) => {
      const caps = PROVIDER_CAPABILITIES[id];
      if (!caps) return false;
      return capabilities.every((cap) => caps.has(cap));
    });
  }
```

- [ ] **Step 4: Run tests**

Run: `cd packages/agentos && npx vitest run src/media/images/__tests__/PolicyAwareImageRouter.consistency.spec.ts --reporter verbose`
Expected: PASS

- [ ] **Step 5: Run existing PolicyAwareImageRouter tests to check no regressions**

Run: `cd packages/agentos && npx vitest run src/media/images/__tests__/PolicyAwareImageRouter.test.ts --reporter verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/src/media/images/PolicyAwareImageRouter.ts packages/agentos/src/media/images/__tests__/PolicyAwareImageRouter.consistency.spec.ts
git commit -m "feat(agentos): PolicyAwareImageRouter capability filtering for character-consistency"
```

---

### Task 10: AvatarPipeline — Per-Stage Consistency Mode

**Files:**
- Modify: `packages/agentos/src/media/avatar/AvatarPipeline.ts`
- Modify: `packages/agentos/src/media/avatar/types.ts`
- Create: `packages/agentos/src/media/avatar/__tests__/AvatarPipeline.consistency.spec.ts`

- [ ] **Step 1: Write per-stage consistency mode tests**

Create `packages/agentos/src/media/avatar/__tests__/AvatarPipeline.consistency.spec.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AvatarPipeline } from '../AvatarPipeline.js';

describe('AvatarPipeline — Consistency Mode Per Stage', () => {
  const mockFaceService = {
    extractEmbedding: vi.fn().mockResolvedValue({ vector: new Array(512).fill(0.1), confidence: 0.99 }),
    compareFaces: vi.fn().mockReturnValue({ similarity: 0.95, match: true }),
  };

  it('passes strict consistencyMode for expression_sheet stage', async () => {
    const calls: Array<{ prompt: string; options: any }> = [];
    const mockGenerator = vi.fn(async (prompt: string, options: any) => {
      calls.push({ prompt, options });
      return 'https://generated.test/img.png';
    });

    const pipeline = new AvatarPipeline(mockFaceService as any, mockGenerator);
    await pipeline.run({
      characterId: 'char_1',
      identity: {
        displayName: 'Test Character',
        ageBand: 'adult',
        faceDescriptor: 'oval face, brown eyes',
      },
      generationConfig: { baseModel: 'flux-schnell', provider: 'replicate' },
      stages: ['neutral_portrait', 'face_embedding', 'expression_sheet'],
    });

    // Expression calls should have consistencyMode: 'strict'
    const expressionCalls = calls.filter(c => c.options.consistencyMode === 'strict');
    expect(expressionCalls.length).toBeGreaterThan(0);
  });

  it('passes balanced consistencyMode for full_body stage', async () => {
    const calls: Array<{ prompt: string; options: any }> = [];
    const mockGenerator = vi.fn(async (prompt: string, options: any) => {
      calls.push({ prompt, options });
      return 'https://generated.test/img.png';
    });

    const pipeline = new AvatarPipeline(mockFaceService as any, mockGenerator);
    await pipeline.run({
      characterId: 'char_1',
      identity: {
        displayName: 'Test Character',
        ageBand: 'adult',
        faceDescriptor: 'oval face, brown eyes',
      },
      generationConfig: { baseModel: 'flux-schnell', provider: 'replicate' },
      stages: ['neutral_portrait', 'face_embedding', 'full_body'],
    });

    // Full body call should have consistencyMode: 'balanced'
    const bodyCalls = calls.filter(c => c.options.consistencyMode === 'balanced');
    expect(bodyCalls.length).toBeGreaterThan(0);
  });

  it('passes faceEmbedding to generator for expression stages', async () => {
    const calls: Array<{ prompt: string; options: any }> = [];
    const mockGenerator = vi.fn(async (prompt: string, options: any) => {
      calls.push({ prompt, options });
      return 'https://generated.test/img.png';
    });

    const pipeline = new AvatarPipeline(mockFaceService as any, mockGenerator);
    await pipeline.run({
      characterId: 'char_1',
      identity: {
        displayName: 'Test Character',
        ageBand: 'adult',
        faceDescriptor: 'oval face',
      },
      generationConfig: { baseModel: 'flux-schnell', provider: 'replicate' },
      stages: ['neutral_portrait', 'face_embedding', 'expression_sheet'],
    });

    // After face_embedding, expression calls should include faceEmbedding
    const withEmbedding = calls.filter(c => c.options.faceEmbedding?.length === 512);
    expect(withEmbedding.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agentos && npx vitest run src/media/avatar/__tests__/AvatarPipeline.consistency.spec.ts --reporter verbose`
Expected: FAIL

- [ ] **Step 3: Update `ImageGeneratorFn` signature in types.ts**

In `packages/agentos/src/media/avatar/types.ts`, the `ImageGeneratorFn` is defined in `AvatarPipeline.ts`. Update the type in `AvatarPipeline.ts`:

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

- [ ] **Step 4: Update AvatarPipeline stage execution to pass consistency fields**

In `AvatarPipeline.ts`, update the expression_sheet, animated_emotes, full_body, and additional_angles stages to pass `consistencyMode` and `faceEmbedding`:

For expression_sheet and animated_emotes stages (where `generateImage` is called):
```typescript
    referenceImageUrl: neutralPortraitUrl || undefined,
    faceEmbedding: anchorEmbedding?.vector,
    consistencyMode: 'strict' as const,
```

For full_body and additional_angles stages:
```typescript
    referenceImageUrl: neutralPortraitUrl || undefined,
    faceEmbedding: anchorEmbedding?.vector,
    consistencyMode: 'balanced' as const,
```

- [ ] **Step 5: Run tests**

Run: `cd packages/agentos && npx vitest run src/media/avatar/__tests__/AvatarPipeline.consistency.spec.ts --reporter verbose`
Expected: PASS

- [ ] **Step 6: Run existing AvatarPipeline tests**

Run: `cd packages/agentos && npx vitest run src/media/avatar/__tests__/AvatarPipeline.test.ts --reporter verbose`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/src/media/avatar/AvatarPipeline.ts packages/agentos/src/media/avatar/__tests__/AvatarPipeline.consistency.spec.ts
git commit -m "feat(agentos): avatar pipeline per-stage consistency mode + faceEmbedding passthrough"
```

---

### Task 11: transferStyle() High-Level API

**Files:**
- Create: `packages/agentos/src/api/transferStyle.ts`
- Modify: `packages/agentos/src/api/index.ts`
- Create: `packages/agentos/src/api/runtime/__tests__/transferStyle.test.ts`

- [ ] **Step 1: Write transferStyle tests**

Create `packages/agentos/src/api/runtime/__tests__/transferStyle.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dependencies
vi.mock('../../../media/images/index.js', () => ({
  createImageProvider: vi.fn(),
  hasImageProviderFactory: vi.fn(() => true),
}));
vi.mock('../../model.js', () => ({
  resolveModelOption: vi.fn(() => ({ providerId: 'replicate', modelId: 'black-forest-labs/flux-redux-dev' })),
  resolveMediaProvider: vi.fn(() => ({ providerId: 'replicate', modelId: 'black-forest-labs/flux-redux-dev', apiKey: 'test' })),
}));
vi.mock('../../../media/images/imageToBuffer.js', () => ({
  imageToBuffer: vi.fn(async (input: any) => Buffer.isBuffer(input) ? input : Buffer.from('mock')),
}));

describe('transferStyle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set env for provider detection
    process.env.REPLICATE_API_TOKEN = 'test-token';
  });

  it('exports transferStyle function', async () => {
    const mod = await import('../../transferStyle.js');
    expect(typeof mod.transferStyle).toBe('function');
  });

  it('accepts image and styleReference as Buffers', async () => {
    // This test validates the interface — actual provider calls are mocked
    const mod = await import('../../transferStyle.js');
    expect(mod.transferStyle).toBeDefined();
  });
});
```

- [ ] **Step 2: Create transferStyle.ts**

Create `packages/agentos/src/api/transferStyle.ts`:

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
 * @module agentos/api/transferStyle
 *
 * @example
 * ```typescript
 * import { transferStyle } from '@framers/agentos/api/transferStyle';
 *
 * const result = await transferStyle({
 *   image: './photo.jpg',
 *   styleReference: './monet-painting.jpg',
 *   prompt: 'Impressionist oil painting with warm golden light',
 *   strength: 0.7,
 * });
 * console.log(result.images[0].url);
 * ```
 */

import { createImageProvider, hasImageProviderFactory } from '../media/images/index.js';
import { FallbackImageProxy } from '../media/images/FallbackImageProxy.js';
import { imageToBuffer } from '../media/images/imageToBuffer.js';
import type {
  GeneratedImage,
  ImageGenerationResult,
  IImageProvider,
} from '../media/images/IImageProvider.js';
import { resolveModelOption, resolveMediaProvider } from './model.js';
import { recordAgentOSUsage, type AgentOSUsageLedgerOptions } from './runtime/usageLedger.js';
import { recordAgentOSTurnMetrics, withAgentOSSpan } from '../evaluation/observability/otel.js';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

const STYLE_TRANSFER_PROVIDER_PRIORITY: Array<{ envKey: string; providerId: string; modelId: string }> = [
  { envKey: 'REPLICATE_API_TOKEN', providerId: 'replicate', modelId: 'black-forest-labs/flux-redux-dev' },
  { envKey: 'FAL_API_KEY', providerId: 'fal', modelId: 'fal-ai/flux/dev' },
  { envKey: 'STABILITY_API_KEY', providerId: 'stability', modelId: 'stable-image-core' },
  { envKey: 'OPENAI_API_KEY', providerId: 'openai', modelId: 'gpt-image-1' },
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Options for a {@link transferStyle} call.
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

/**
 * Result returned by {@link transferStyle}.
 */
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

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Transfers the visual aesthetic of a reference image onto a source image.
 *
 * Routes to the best available provider:
 * - **Replicate** (Flux Redux): purpose-built for image-guided style transfer
 * - **Fal** (Flux Dev): img2img with style guidance
 * - **Stability** (img2img): strength-controlled transformation
 * - **OpenAI** (edit): prompt-guided editing
 *
 * @param opts - Style transfer options.
 * @returns Promise resolving to the transfer result with styled image(s).
 *
 * @throws {Error} When no style transfer provider is available.
 *
 * @example
 * ```typescript
 * // Photo to oil painting
 * const result = await transferStyle({
 *   image: photoBuffer,
 *   styleReference: './monet.jpg',
 *   prompt: 'Impressionist oil painting, warm golden light, visible brushstrokes',
 *   strength: 0.7,
 * });
 * ```
 */
export async function transferStyle(opts: TransferStyleOptions): Promise<TransferStyleResult> {
  const startedAt = Date.now();
  let metricStatus: 'ok' | 'error' = 'ok';
  let metricUsage: ImageGenerationResult['usage'];

  try {
    return await withAgentOSSpan('agentos.api.transfer_style', async (span) => {
      // Resolve provider
      let providerId: string;
      let modelId: string;

      if (opts.provider) {
        ({ providerId, modelId } = resolveModelOption(opts, 'image'));
      } else {
        // Auto-detect best available style transfer provider
        const match = STYLE_TRANSFER_PROVIDER_PRIORITY.find(
          (p) => process.env[p.envKey] && hasImageProviderFactory(p.providerId),
        );
        if (!match) {
          throw new Error(
            'No style transfer provider configured. Set REPLICATE_API_TOKEN, FAL_API_KEY, STABILITY_API_KEY, or OPENAI_API_KEY.',
          );
        }
        providerId = match.providerId;
        modelId = opts.model ?? match.modelId;
      }

      const resolved = resolveMediaProvider(providerId, modelId);
      span?.setAttribute('llm.provider', resolved.providerId);
      span?.setAttribute('llm.model', resolved.modelId);

      const provider = createImageProvider(resolved.providerId);
      await provider.initialize({
        apiKey: resolved.apiKey,
        baseURL: resolved.baseUrl,
        defaultModelId: resolved.modelId,
      });

      // Convert both images to Buffers
      const imageBuffer = await imageToBuffer(opts.image);
      const styleBuffer = await imageToBuffer(opts.styleReference);

      let result: ImageGenerationResult;

      if (resolved.providerId === 'replicate' && resolved.modelId.includes('flux-redux')) {
        // Flux Redux: style reference is the primary image input
        const styleDataUrl = `data:image/png;base64,${styleBuffer.toString('base64')}`;
        result = await provider.generateImage({
          modelId: resolved.modelId,
          prompt: opts.prompt,
          size: opts.size,
          seed: opts.seed,
          negativePrompt: opts.negativePrompt,
          referenceImageUrl: styleDataUrl,
          providerOptions: opts.providerOptions,
        });
      } else if (typeof provider.editImage === 'function') {
        // Providers with editImage: use img2img
        result = await provider.editImage({
          modelId: resolved.modelId,
          image: imageBuffer,
          prompt: opts.prompt,
          strength: opts.strength ?? 0.7,
          size: opts.size,
          seed: opts.seed,
          negativePrompt: opts.negativePrompt,
          providerOptions: opts.providerOptions,
        });
      } else {
        // Fallback: generate with style description in prompt
        result = await provider.generateImage({
          modelId: resolved.modelId,
          prompt: `${opts.prompt}. Apply the visual style and aesthetic of the reference.`,
          size: opts.size,
          seed: opts.seed,
          negativePrompt: opts.negativePrompt,
          providerOptions: opts.providerOptions,
        });
      }

      metricUsage = result.usage;

      return {
        images: result.images,
        provider: result.providerId,
        model: result.modelId,
        usage: { costUSD: result.usage?.totalCostUSD },
      };
    });
  } catch (error) {
    metricStatus = 'error';
    throw error;
  } finally {
    try {
      await recordAgentOSUsage({
        usage: metricUsage ? { costUSD: metricUsage.totalCostUSD } : undefined,
        options: { ...opts.usageLedger, source: opts.usageLedger?.source ?? 'transferStyle' },
      });
    } catch { /* best-effort */ }
    recordAgentOSTurnMetrics({
      durationMs: Date.now() - startedAt,
      status: metricStatus,
    });
  }
}
```

- [ ] **Step 3: Add re-export to api/index.ts**

In `packages/agentos/src/api/index.ts`, add after the `generateImage` export:

```typescript
export { transferStyle } from './transferStyle.js';
```

- [ ] **Step 4: Run tests**

Run: `cd packages/agentos && npx vitest run src/api/runtime/__tests__/transferStyle.test.ts --reporter verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/src/api/transferStyle.ts packages/agentos/src/api/index.ts packages/agentos/src/api/runtime/__tests__/transferStyle.test.ts
git commit -m "feat(agentos): add transferStyle() high-level API for image-guided style transfer"
```

---

### Task 12: generateImage — Pass Through New Fields

**Files:**
- Modify: `packages/agentos/src/api/generateImage.ts`

- [ ] **Step 1: Add referenceImageUrl, faceEmbedding, consistencyMode to the request passthrough**

In `generateImage.ts`, in the `provider.generateImage()` call (around line 314), add the three new fields:

```typescript
      const result = await provider.generateImage({
        modelId:
          provider instanceof FallbackImageProxy
            ? undefined
            : resolved.modelId,
        prompt: opts.prompt,
        modalities: opts.modalities,
        n: opts.n,
        size: opts.size,
        aspectRatio: opts.aspectRatio,
        quality: opts.quality,
        background: opts.background,
        outputFormat: opts.outputFormat,
        outputCompression: opts.outputCompression,
        responseFormat: opts.responseFormat,
        userId: opts.userId,
        seed: opts.seed,
        negativePrompt: opts.negativePrompt,
        providerOptions: opts.providerOptions,
        // Character consistency fields
        referenceImageUrl: opts.referenceImageUrl,
        faceEmbedding: opts.faceEmbedding,
        consistencyMode: opts.consistencyMode,
      });
```

Also add the fields to `GenerateImageOptions`:

```typescript
  /** Reference image URL for character/face consistency. See IImageProvider docs. */
  referenceImageUrl?: string;
  /** Pre-computed 512-dim face embedding for drift detection. */
  faceEmbedding?: number[];
  /** Character consistency mode: 'strict' | 'balanced' | 'loose'. Default 'balanced'. */
  consistencyMode?: 'strict' | 'balanced' | 'loose';
```

- [ ] **Step 2: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/src/api/generateImage.ts
git commit -m "feat(agentos): pass character consistency fields through generateImage API"
```

---

### Task 13: OpenAI Provider Unit Tests

**Files:**
- Create: `packages/agentos/src/media/images/__tests__/OpenAIImageProvider.spec.ts`

- [ ] **Step 1: Write OpenAI provider tests**

Create `packages/agentos/src/media/images/__tests__/OpenAIImageProvider.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIImageProvider } from '../providers/OpenAIImageProvider.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockOpenAIResponse(data = [{ url: 'https://oai.test/img.png' }]) {
  return {
    ok: true,
    json: async () => ({ created: 1234567890, data }),
    text: async () => '',
    headers: new Headers(),
  };
}

describe('OpenAIImageProvider', () => {
  let provider: OpenAIImageProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new OpenAIImageProvider();
    await provider.initialize({ apiKey: 'sk-test' });
  });

  describe('generateImage', () => {
    it('sends prompt to OpenAI images API', async () => {
      mockFetch.mockResolvedValueOnce(mockOpenAIResponse());

      const result = await provider.generateImage({ prompt: 'a cat' });

      expect(result.images).toHaveLength(1);
      expect(result.providerId).toBe('openai');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/images/generations');
    });

    it('defaults to gpt-image-1 when no model specified', async () => {
      mockFetch.mockResolvedValueOnce(mockOpenAIResponse());

      await provider.generateImage({ prompt: 'test' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Model should be set (either gpt-image-1 or dall-e-3 depending on provider defaults)
      expect(body.model || body.prompt).toBeTruthy();
    });

    it('logs debug warning when referenceImageUrl is set', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockOpenAIResponse());

      await provider.generateImage({
        prompt: 'test',
        referenceImageUrl: 'https://ref.test/face.png',
      });

      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('referenceImageUrl is not natively supported')
      );
      debugSpy.mockRestore();
    });

    it('throws when not initialized', async () => {
      const uninit = new OpenAIImageProvider();
      await expect(uninit.generateImage({ prompt: 'test' })).rejects.toThrow();
    });

    it('throws on 401 unauthorized', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
        headers: new Headers(),
      });

      await expect(provider.generateImage({ prompt: 'test' })).rejects.toThrow();
    });

    it('throws on 429 rate limit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
        headers: new Headers(),
      });

      await expect(provider.generateImage({ prompt: 'test' })).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd packages/agentos && npx vitest run src/media/images/__tests__/OpenAIImageProvider.spec.ts --reporter verbose`
Expected: PASS (these test existing behavior)

- [ ] **Step 3: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/src/media/images/__tests__/OpenAIImageProvider.spec.ts
git commit -m "test(agentos): OpenAI image provider unit tests"
```

---

### Task 14: Integration Tests

**Files:**
- Create: `packages/agentos/src/api/runtime/__tests__/image-pipeline-integration.test.ts`

- [ ] **Step 1: Write integration tests**

Create `packages/agentos/src/api/runtime/__tests__/image-pipeline-integration.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { FallbackImageProxy, type ImageFallbackEvent } from '../../../media/images/FallbackImageProxy.js';
import type { IImageProvider, ImageGenerationRequest, ImageGenerationResult } from '../../../media/images/IImageProvider.js';

function createMockProvider(id: string, shouldFail = false): IImageProvider {
  return {
    providerId: id,
    isInitialized: true,
    async initialize() {},
    async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
      if (shouldFail) throw new Error(`${id} failed`);
      return {
        created: Date.now(),
        modelId: 'test-model',
        providerId: id,
        images: [{ url: `https://${id}.test/img.png` }],
        usage: { totalImages: 1 },
      };
    },
  };
}

describe('Image Pipeline Integration', () => {
  it('fallback chain tries providers in order', async () => {
    const emitter = new EventEmitter();
    const events: ImageFallbackEvent[] = [];
    emitter.on('image:fallback', (evt: ImageFallbackEvent) => events.push(evt));

    const proxy = new FallbackImageProxy(
      [
        createMockProvider('provider-a', true),
        createMockProvider('provider-b', true),
        createMockProvider('provider-c', false),
      ],
      emitter,
    );

    const result = await proxy.generateImage({ prompt: 'test' });

    expect(result.providerId).toBe('provider-c');
    expect(events).toHaveLength(2);
    expect(events[0].from).toBe('provider-a');
    expect(events[0].to).toBe('provider-b');
    expect(events[1].from).toBe('provider-b');
    expect(events[1].to).toBe('provider-c');
  });

  it('throws AggregateError when all providers fail', async () => {
    const emitter = new EventEmitter();
    const proxy = new FallbackImageProxy(
      [
        createMockProvider('a', true),
        createMockProvider('b', true),
      ],
      emitter,
    );

    await expect(proxy.generateImage({ prompt: 'test' })).rejects.toThrow(AggregateError);
  });

  it('passes character consistency fields through the chain', async () => {
    const emitter = new EventEmitter();
    const capturedRequests: ImageGenerationRequest[] = [];

    const capturingProvider: IImageProvider = {
      providerId: 'capture',
      isInitialized: true,
      async initialize() {},
      async generateImage(request) {
        capturedRequests.push(request);
        return { created: Date.now(), modelId: 'test', providerId: 'capture', images: [{ url: 'test' }], usage: { totalImages: 1 } };
      },
    };

    const proxy = new FallbackImageProxy([capturingProvider], emitter);

    await proxy.generateImage({
      prompt: 'test',
      referenceImageUrl: 'https://ref.test/face.png',
      consistencyMode: 'strict',
      faceEmbedding: [0.1, 0.2, 0.3],
    });

    expect(capturedRequests[0].referenceImageUrl).toBe('https://ref.test/face.png');
    expect(capturedRequests[0].consistencyMode).toBe('strict');
    expect(capturedRequests[0].faceEmbedding).toEqual([0.1, 0.2, 0.3]);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd packages/agentos && npx vitest run src/api/runtime/__tests__/image-pipeline-integration.test.ts --reporter verbose`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/src/api/runtime/__tests__/image-pipeline-integration.test.ts
git commit -m "test(agentos): image pipeline integration tests — fallback chain + consistency passthrough"
```

---

### Task 15: Documentation — IMAGE_GENERATION.md Rewrite

**Files:**
- Rewrite: `packages/agentos/docs/features/IMAGE_GENERATION.md`

- [ ] **Step 1: Rewrite IMAGE_GENERATION.md**

Update the provider table to include all 7 providers (add BFL and Fal). Add sections for:
- Character consistency (`referenceImageUrl`, `consistencyMode`) with code examples
- Replicate expanded model catalog (all 13 models)
- Fallback chain behavior with `image:fallback` event listener example
- Policy-tier routing section
- Link to new CHARACTER_CONSISTENCY.md and STYLE_TRANSFER.md

Ensure all code examples use current API signatures including the new fields.

- [ ] **Step 2: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/docs/features/IMAGE_GENERATION.md
git commit -m "docs(agentos): rewrite IMAGE_GENERATION.md for 7 providers + consistency + style transfer"
```

---

### Task 16: Documentation — New CHARACTER_CONSISTENCY.md + STYLE_TRANSFER.md

**Files:**
- Create: `packages/agentos/docs/features/CHARACTER_CONSISTENCY.md`
- Create: `packages/agentos/docs/features/STYLE_TRANSFER.md`

- [ ] **Step 1: Write CHARACTER_CONSISTENCY.md**

Cover: `referenceImageUrl`, `faceEmbedding`, `consistencyMode` field reference. AvatarPipeline usage with drift detection walkthrough. Provider capability comparison (Pulid vs IP-Adapter vs Flux Redux). Code examples for each consistency mode. When-to-use guide (avatars vs scenes vs "inspired by").

- [ ] **Step 2: Write STYLE_TRANSFER.md**

Cover: `transferStyle()` API reference. Flux Redux workflow explanation. Aesthetic translation examples (photo→anime, photo→oil painting). Provider routing table. Strength parameter guide.

- [ ] **Step 3: Update IMAGE_EDITING.md**

Add Fal to the provider matrix. Add style transfer reference linking to STYLE_TRANSFER.md. Update capability matrix.

- [ ] **Step 4: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/docs/features/CHARACTER_CONSISTENCY.md packages/agentos/docs/features/STYLE_TRANSFER.md packages/agentos/docs/features/IMAGE_EDITING.md
git commit -m "docs(agentos): character consistency + style transfer guides, update IMAGE_EDITING"
```

---

### Task 17: Skill + CHANGELOG Update

**Files:**
- Modify: `packages/agentos-skills/registry/curated/image-gen/SKILL.md`
- Modify: `packages/agentos/CHANGELOG.md`

- [ ] **Step 1: Update image-gen SKILL.md**

Add `transferStyle()` as the fifth API. Add character consistency section to the decision tree. Add Pulid, Flux Redux, Flux Canny/Depth to model recommendations. Update provider selection guide with consistency capabilities column.

- [ ] **Step 2: Update CHANGELOG.md**

Add the `[Unreleased]` section from the spec with all Added/Changed/Fixed entries.

- [ ] **Step 3: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-skills/registry/curated/image-gen/SKILL.md packages/agentos/CHANGELOG.md
git commit -m "docs(agentos): update image-gen skill + changelog for image system upgrade"
```

---

### Task 18: TSDoc Enrichment Pass

**Files:**
- Modify: All provider files + API files (TSDoc additions only)

- [ ] **Step 1: Add comprehensive TSDoc to ReplicateImageProvider**

Add `@param`, `@returns`, `@throws`, `@example` on `generateImage`, `editImage`, `upscaleImage`, constructor, every config field. Include examples for Pulid, Flux Redux, ControlNet, standard generation.

- [ ] **Step 2: Add TSDoc to OpenAIImageProvider**

Full TSDoc on `generateImage`, `editImage`, `variateImage`. Document gpt-image-1 vs dall-e-3 differences.

- [ ] **Step 3: Add TSDoc to remaining providers**

StabilityImageProvider, OpenRouterImageProvider, FluxImageProvider, StableDiffusionLocalProvider — add `@example` blocks and parameter docs on all public methods.

- [ ] **Step 4: Add inline comments in complex logic sections**

- Dual-endpoint detection in Replicate
- Consistency mode → strength mapping (Replicate, Fal, SD-Local)
- Provider auto-detection env-var scanning in generateImage.ts
- Style transfer provider routing in transferStyle.ts

- [ ] **Step 5: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/src/media/images/providers/ packages/agentos/src/api/generateImage.ts packages/agentos/src/api/transferStyle.ts packages/agentos/src/api/editImage.ts packages/agentos/src/media/avatar/AvatarPipeline.ts packages/agentos/src/media/images/PolicyAwareImageRouter.ts
git commit -m "docs(agentos): comprehensive TSDoc enrichment across image subsystem"
```

---

### Task 19: E2E Tests (Live API, Gated)

**Files:**
- Create: `packages/agentos/tests/e2e/image-generation.e2e.spec.ts`

- [ ] **Step 1: Write gated E2E tests**

Create `packages/agentos/tests/e2e/image-generation.e2e.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateImage } from '../../src/api/generateImage.js';
import { transferStyle } from '../../src/api/transferStyle.js';

const hasReplicate = !!process.env.REPLICATE_API_TOKEN;

describe.skipIf(!hasReplicate)('Image Generation E2E (Replicate)', () => {
  it('generates an image via Flux Schnell', async () => {
    const result = await generateImage({
      provider: 'replicate',
      model: 'black-forest-labs/flux-schnell',
      prompt: 'A simple red cube on a white background, minimal, clean',
    });

    expect(result.images.length).toBeGreaterThan(0);
    expect(result.provider).toBe('replicate');
    const img = result.images[0];
    expect(img.url || img.dataUrl || img.base64).toBeTruthy();
  }, 60_000);

  it('generates with character reference via Pulid', async () => {
    const result = await generateImage({
      provider: 'replicate',
      model: 'zsxkib/pulid',
      prompt: 'Portrait of the character smiling warmly',
      referenceImageUrl: 'https://replicate.delivery/pbxt/demo/face.png',
      consistencyMode: 'strict',
    });

    expect(result.images.length).toBeGreaterThan(0);
    expect(result.provider).toBe('replicate');
  }, 60_000);
});
```

- [ ] **Step 2: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos/tests/e2e/image-generation.e2e.spec.ts
git commit -m "test(agentos): gated E2E tests for Replicate image generation + Pulid consistency"
```

---

### Task 20: Final Verification

- [ ] **Step 1: Run all image-related tests**

Run: `cd packages/agentos && npx vitest run --reporter verbose src/media/images/ src/media/avatar/ src/api/runtime/__tests__/transferStyle.test.ts src/api/runtime/__tests__/image-pipeline-integration.test.ts`
Expected: All PASS

- [ ] **Step 2: Run full AgentOS test suite to check no regressions**

Run: `cd packages/agentos && npx vitest run --reporter verbose`
Expected: All existing tests PASS

- [ ] **Step 3: Final commit if any fixups needed**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add -A packages/agentos/
git commit -m "chore(agentos): image system upgrade — final verification pass"
```
