/**
 * @file index.ts
 * Barrel export for the avatar generation pipeline.
 */

export { AvatarPipeline, type ImageGeneratorFn } from './AvatarPipeline.js';

export type {
  AvatarGenerationStage,
  AvatarGenerationRequest,
  AvatarGenerationJob,
  DriftAuditReport,
  AvatarGenerationResult,
} from './types.js';

export {
  AVATAR_EMOTIONS,
  type AvatarEmotion,
  buildPortraitPrompt,
  buildExpressionPrompt,
  buildEmotePrompt,
} from './prompts.js';
