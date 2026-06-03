/**
 * @module io/segmentation/providers/ReplicateSegmentationProvider
 *
 * Hosted segmentation via Replicate. Geometric prompts (points/box/automatic)
 * route to a SAM2 model; text prompts route to a GroundedSAM model. Contains
 * its own minimal predict/poll cycle (no dependency on the image provider).
 */
import { ApiKeyPool } from '../../../core/providers/ApiKeyPool.js';
import { getImageProviderOptions } from '../../media/images/IImageProvider.js';
import { SegmentationProviderError, SegmentationModeNotSupportedError } from '../errors.js';
import { computeMaskBbox } from '../maskGeometry.js';
import type {
  ISegmentationProvider,
  ReplicateSegmentationOptions,
  SegmentationMode,
  SegmentationRequest,
  SegmentationResult,
  SegmentMask,
} from '../types.js';

const REPLICATE_BASE = 'https://api.replicate.com/v1';
/** Default SAM2 model for geometric prompts. Verify/adjust in the smoke step. */
const DEFAULT_SAM_MODEL = 'meta/sam-2';
/** Default GroundedSAM model for text prompts. Verify/adjust in the smoke step. */
const DEFAULT_GROUNDED_SAM_MODEL = 'schananas/grounded_sam';

type ReplicatePrediction = {
  id?: string;
  status?: string;
  output?: unknown;
  error?: string;
  urls?: { get?: string };
};

type MaskRef = string | { mask?: string; score?: number; label?: string; box?: number[] };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ReplicateSegmentationProvider implements ISegmentationProvider {
  public readonly providerId = 'replicate';
  public isInitialized = false;
  public defaultModelId?: string;
  private keyPool!: ApiKeyPool;
  private readonly versionCache = new Map<string, string>();

  async initialize(config: Record<string, unknown>): Promise<void> {
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
    if (!apiKey) {
      throw new SegmentationProviderError('Replicate segmentation provider requires apiKey.', 'provider_failed');
    }
    this.keyPool = new ApiKeyPool(apiKey);
    this.defaultModelId =
      typeof config.defaultModelId === 'string' && config.defaultModelId.trim()
        ? config.defaultModelId.trim()
        : DEFAULT_SAM_MODEL;
    this.isInitialized = true;
  }

  supportedModes(): ReadonlyArray<SegmentationMode> {
    // Hosted Replicate v1: GroundedSAM (text) + SAM2 automatic ("segment
    // everything"). Coordinate prompts (points/box) have no clean hosted
    // single-image model and await a coordinate-capable provider.
    return ['text', 'automatic'];
  }

  async segment(request: SegmentationRequest): Promise<SegmentationResult> {
    if (!this.isInitialized) {
      throw new SegmentationProviderError('Replicate segmentation provider is not initialized.', 'provider_failed');
    }
    if (!this.supportedModes().includes(request.mode)) {
      throw new SegmentationModeNotSupportedError(this.providerId, request.mode);
    }
    const startedAt = Date.now();
    const providerOptions = getImageProviderOptions<ReplicateSegmentationOptions>(this.providerId, request.providerOptions);

    const isText = request.mode === 'text';
    const modelId =
      request.modelId
      || (isText
        ? (providerOptions?.groundedSamModelId ?? DEFAULT_GROUNDED_SAM_MODEL)
        : (providerOptions?.samModelId ?? this.defaultModelId ?? DEFAULT_SAM_MODEL));

    const input = this.buildInput(request, providerOptions);

    let prediction: ReplicatePrediction;
    try {
      prediction = await this.runPrediction(modelId, input, providerOptions);
    } catch (err) {
      if (err instanceof SegmentationProviderError) throw err;
      throw new SegmentationProviderError(
        `Replicate segmentation request failed: ${(err as Error).message}`, 'provider_failed', err,
      );
    }

    if (prediction.status === 'failed') {
      throw new SegmentationProviderError(
        `Replicate segmentation failed: ${prediction.error ?? 'unknown error'}`, 'provider_failed',
      );
    }
    if (prediction.status === 'canceled') {
      throw new SegmentationProviderError('Replicate segmentation was canceled.', 'provider_failed');
    }

    const { width, height } = await this.imageDimensions(request.image);
    let masks = await this.decodeMasks(prediction.output);
    if (typeof request.minScore === 'number') masks = masks.filter((m) => m.score >= request.minScore!);
    if (typeof request.maxMasks === 'number') masks = masks.slice(0, request.maxMasks);
    masks = masks.map((m, i) => ({
      ...m,
      index: i,
      // GroundedSAM output carries no per-mask label; fall back to the phrase.
      label: m.label ?? (request.mode === 'text' ? request.prompt : undefined),
    }));

    return {
      masks,
      width,
      height,
      providerId: this.providerId,
      modelId,
      promptMode: request.mode,
      usage: { totalMasks: masks.length },
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Build the Replicate `input` object for the request's mode. Field names
   * target the v1 output contract; confirm per chosen model in the smoke step.
   */
  private buildInput(
    request: SegmentationRequest, providerOptions?: ReplicateSegmentationOptions,
  ): Record<string, unknown> {
    const imageDataUrl = `data:image/png;base64,${request.image.toString('base64')}`;
    const input: Record<string, unknown> = { image: imageDataUrl, ...(providerOptions?.input ?? {}) };
    if (request.mode === 'text') {
      // GroundedSAM uses `mask_prompt` for the open-vocabulary phrase.
      input.mask_prompt = request.prompt;
    }
    // `automatic` mode: the SAM2 model segments everything from `image` alone.
    // Tuning params (points_per_side, pred_iou_thresh, stability_score_thresh,
    // use_m2m) flow through providerOptions.replicate.input.
    return input;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Token ${this.keyPool.next()}`, 'Content-Type': 'application/json' };
  }

  private async runPrediction(
    modelId: string, input: Record<string, unknown>, providerOptions?: ReplicateSegmentationOptions,
  ): Promise<ReplicatePrediction> {
    const pollIntervalMs = providerOptions?.pollIntervalMs ?? 1000;
    const timeoutMs = providerOptions?.timeoutMs ?? 120_000;

    // Create the prediction through the version endpoint, which serves both
    // official and community models. The version-less /models/.../predictions
    // endpoint only serves official models and 404s for community ones.
    const version = await this.resolveVersion(modelId);
    const res = await fetch(`${REPLICATE_BASE}/predictions`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ version, input }),
    });
    if (!res.ok) {
      throw new SegmentationProviderError(`Replicate returned ${res.status}: ${await res.text()}`, 'provider_failed');
    }
    let prediction = (await res.json()) as ReplicatePrediction;

    const deadline = Date.now() + timeoutMs;
    while (
      prediction.status
      && !['succeeded', 'failed', 'canceled'].includes(prediction.status)
      && prediction.urls?.get
    ) {
      if (Date.now() > deadline) {
        throw new SegmentationProviderError('Replicate segmentation timed out.', 'timeout');
      }
      await sleep(pollIntervalMs);
      const pollRes = await fetch(prediction.urls.get, { headers: this.headers() });
      if (!pollRes.ok) {
        throw new SegmentationProviderError(`Replicate poll returned ${pollRes.status}.`, 'provider_failed');
      }
      prediction = (await pollRes.json()) as ReplicatePrediction;
    }
    return prediction;
  }

  /**
   * Resolve a model id to a concrete version hash. An explicit
   * `owner/name:version` pin is used directly; a bare `owner/name` is looked up
   * via the model API for its latest version (cached per provider instance).
   */
  private async resolveVersion(modelId: string): Promise<string> {
    const colon = modelId.indexOf(':');
    if (colon >= 0) return modelId.slice(colon + 1);

    const cached = this.versionCache.get(modelId);
    if (cached) return cached;

    const slash = modelId.indexOf('/');
    if (slash < 1) {
      throw new SegmentationProviderError(
        `Invalid modelId "${modelId}": expected "owner/model" or "owner/model:version".`,
        'invalid_request',
      );
    }
    const res = await fetch(`${REPLICATE_BASE}/models/${modelId}`, { headers: this.headers() });
    if (!res.ok) {
      throw new SegmentationProviderError(`Failed to resolve model "${modelId}": ${res.status}`, 'provider_failed');
    }
    const data = (await res.json()) as { latest_version?: { id?: string } };
    const version = data.latest_version?.id;
    if (!version) {
      throw new SegmentationProviderError(`Model "${modelId}" has no published version.`, 'provider_failed');
    }
    this.versionCache.set(modelId, version);
    return version;
  }

  private extractMaskRefs(output: unknown): MaskRef[] {
    if (Array.isArray(output)) return output as MaskRef[];
    if (output && typeof output === 'object') {
      const o = output as Record<string, unknown>;
      // meta/sam-2 automatic output: { combined_mask, individual_masks: [...] }
      if (Array.isArray(o.individual_masks)) return o.individual_masks as MaskRef[];
      if (Array.isArray(o.masks)) return o.masks as MaskRef[];
      if (typeof o.mask === 'string') return [o.mask];
      if (typeof o.combined_mask === 'string') return [o.combined_mask];
    }
    if (typeof output === 'string') return [output];
    return [];
  }

  private async fetchMaskBytes(url: string): Promise<Buffer> {
    if (url.startsWith('data:')) {
      return Buffer.from(url.substring(url.indexOf(',') + 1), 'base64');
    }
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw new SegmentationProviderError(`Failed to download mask: ${res.status}`, 'provider_failed');
    }
    return Buffer.from(await res.arrayBuffer());
  }

  private async decodeMasks(output: unknown): Promise<SegmentMask[]> {
    const refs = this.extractMaskRefs(output);
    const masks: SegmentMask[] = [];
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      const url = typeof ref === 'string' ? ref : ref.mask;
      if (typeof url !== 'string') continue;
      const png = await this.fetchMaskBytes(url);
      const bbox =
        typeof ref === 'object' && Array.isArray(ref.box) && ref.box.length === 4
          ? { x: ref.box[0], y: ref.box[1], width: ref.box[2] - ref.box[0], height: ref.box[3] - ref.box[1] }
          : await computeMaskBbox(png);
      if (!bbox) continue;
      masks.push({
        mask: png,
        bbox,
        score: typeof ref === 'object' && typeof ref.score === 'number' ? ref.score : 1,
        label: typeof ref === 'object' && typeof ref.label === 'string' ? ref.label : undefined,
        index: i,
      });
    }
    return masks;
  }

  private async imageDimensions(image: Buffer): Promise<{ width: number; height: number }> {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(image).metadata();
    return { width: meta.width ?? 0, height: meta.height ?? 0 };
  }
}
