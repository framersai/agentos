/**
 * Social Posting module barrel exports.
 *
 * @module @framers/agentos/social-posting
 *
 * Provides the post lifecycle engine ({@link SocialPostManager}) and
 * platform-aware content adaptation ({@link ContentAdaptationEngine}).
 */
export { SocialPostManager, type SocialPost, type SocialPostStatus, type SocialPostPlatformResult, type CreateDraftInput, } from './SocialPostManager';
export { ContentAdaptationEngine, type PlatformConstraints, type AdaptedContent, } from './ContentAdaptationEngine';
export { SocialAbstractService, type SocialRequestOptions, type SocialServiceConfig, } from './SocialAbstractService';
//# sourceMappingURL=index.d.ts.map