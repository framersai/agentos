/**
 * Social Posting module barrel exports.
 *
 * @module @framers/agentos/social-posting
 *
 * Provides the post lifecycle engine ({@link SocialPostManager}) and
 * platform-aware content adaptation ({@link ContentAdaptationEngine}).
 */
// Post lifecycle state machine
export { SocialPostManager, } from './SocialPostManager.js';
// Platform-specific content adaptation
export { ContentAdaptationEngine, } from './ContentAdaptationEngine.js';
// Shared HTTP base class for channel service implementations
export { SocialAbstractService, } from './SocialAbstractService.js';
//# sourceMappingURL=index.js.map