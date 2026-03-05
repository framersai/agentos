/**
 * @fileoverview Social Posting module — barrel exports.
 * @module @framers/agentos/social-posting
 *
 * Provides the post lifecycle engine ({@link SocialPostManager}) and
 * platform-aware content adaptation ({@link ContentAdaptationEngine}).
 */

// Post lifecycle state machine
export {
  SocialPostManager,
  type SocialPost,
  type SocialPostStatus,
  type SocialPostPlatformResult,
  type CreateDraftInput,
} from './SocialPostManager';

// Platform-specific content adaptation
export {
  ContentAdaptationEngine,
  type PlatformConstraints,
  type AdaptedContent,
} from './ContentAdaptationEngine';
