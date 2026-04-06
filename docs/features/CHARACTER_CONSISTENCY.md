# Character Consistency — Face-Preserving Image Generation

> Generate images that maintain a consistent character identity across multiple outputs using reference images and face embeddings.

---

## Overview

Character consistency lets you anchor generated images to a reference face or character, ensuring the same person appears across portraits, expressions, full-body shots, and scene illustrations. AgentOS supports three levels of consistency via the `consistencyMode` parameter:

| Mode | Strength | Use Case |
|------|----------|----------|
| `'strict'` | 0.85–0.9 | Avatar expression sheets, emotion variants. Face must match exactly. |
| `'balanced'` | 0.6 | Full-body shots, different angles. Recognizable but allows natural variation. |
| `'loose'` | 0.3 | "Inspired by" generations. Style/mood carries over, face may drift. |

## Provider Support

| Provider | Mechanism | Models |
|----------|-----------|--------|
| **Replicate** | Pulid (strict), Flux image input (balanced/loose) | `zsxkib/pulid`, `black-forest-labs/flux-dev` |
| **Fal** | IP-Adapter | `fal-ai/flux/dev` |
| **SD-Local** | ControlNet + IP-Adapter extension | Any SD 1.5 / SDXL checkpoint |
| OpenAI | Not supported (graceful ignore) | — |
| Stability | Not supported (graceful ignore) | — |

## Basic Usage

```typescript
import { generateImage } from '@framers/agentos';

// Generate a consistent expression variant
const result = await generateImage({
  provider: 'replicate',
  prompt: 'Portrait of the character smiling warmly, soft lighting',
  referenceImageUrl: 'https://storage.example.com/character-neutral.png',
  consistencyMode: 'strict',
});
```

When `consistencyMode` is `'strict'` and no model is explicitly set, Replicate auto-selects `zsxkib/pulid` for maximum face consistency.

## Fields Reference

### `referenceImageUrl`

URL or base64 data URI of the reference character image. Each provider maps this to its native mechanism:

- **Replicate (Pulid):** `main_face_image` input
- **Replicate (standard Flux):** `image` input with `image_strength`
- **Fal:** `ip_adapter_image` body field
- **SD-Local:** ControlNet `input_image` with IP-Adapter preprocessor

### `faceEmbedding`

Optional 512-dimensional vector from InsightFace or equivalent. Used by the `AvatarPipeline` for drift detection — after generating each image, the pipeline extracts the face embedding from the output and compares it to this anchor via cosine similarity. Images that drift below the threshold (default 0.6) are regenerated.

### `consistencyMode`

Controls how aggressively the provider preserves the reference identity:

```typescript
// Strict — for expression sheets where faces must match
await generateImage({
  prompt: 'Character looking angry, dramatic lighting',
  referenceImageUrl: neutralPortrait,
  consistencyMode: 'strict',  // Pulid auto-selected on Replicate
});

// Balanced — for full-body shots
await generateImage({
  prompt: 'Full body shot of the character walking through a market',
  referenceImageUrl: neutralPortrait,
  consistencyMode: 'balanced',
});

// Loose — for "inspired by" mood pieces
await generateImage({
  prompt: 'Abstract portrait in the style of the character',
  referenceImageUrl: neutralPortrait,
  consistencyMode: 'loose',
});
```

## AvatarPipeline Integration

The `AvatarPipeline` uses consistency modes per stage:

| Stage | Mode | Rationale |
|-------|------|-----------|
| `neutral_portrait` | none | This IS the anchor — no reference exists yet |
| `face_embedding` | none | Extraction, not generation |
| `expression_sheet` | `'strict'` | Facial identity must match across all emotions |
| `animated_emotes` | `'strict'` | Same character in motion |
| `full_body` | `'balanced'` | Body proportions can vary; face should be recognizable |
| `additional_angles` | `'balanced'` | 3/4 and profile views naturally differ from frontal |

```typescript
import { AvatarPipeline } from '@framers/agentos/media/avatar';

const pipeline = new AvatarPipeline(faceService, imageGenerator);
const result = await pipeline.generate({
  characterId: 'hero_001',
  identity: {
    displayName: 'Kael Stormwind',
    ageBand: 'young_adult',
    faceDescriptor: 'sharp jawline, green eyes, short dark hair, small scar above left eyebrow',
  },
  generationConfig: {
    baseModel: 'black-forest-labs/flux-dev',
    provider: 'replicate',
  },
  stages: ['neutral_portrait', 'face_embedding', 'expression_sheet', 'full_body'],
});
```

## Choosing the Right Mode

- **Avatars and expression sheets:** Always `'strict'`. The face is the product.
- **Scene illustrations with known characters:** `'balanced'`. Character should be recognizable but the scene composition matters more.
- **Style exploration and mood boards:** `'loose'`. The reference influences the vibe, not the pixels.
- **No reference at all:** Omit `referenceImageUrl` entirely. The fields are fully optional.

## Related

- [Image Generation](./IMAGE_GENERATION.md) — Provider-agnostic generation API
- [Style Transfer](./STYLE_TRANSFER.md) — Transfer visual aesthetics between images
- [Image Editing](./IMAGE_EDITING.md) — Img2img, inpainting, upscaling
