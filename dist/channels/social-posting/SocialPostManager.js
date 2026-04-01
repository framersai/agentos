/**
 * @fileoverview Social Post Manager — post lifecycle engine.
 * @module @framers/agentos/social-posting/SocialPostManager
 *
 * Manages the full lifecycle of social media posts through a state machine:
 *
 *   DRAFT --> SCHEDULED --> PUBLISHING --> PUBLISHED
 *                              |
 *                            ERROR --> RETRY --> PUBLISHING
 *
 * Storage is in-memory (Map<string, SocialPost>). The backend module will
 * layer on DB persistence via IStorageAdapter when this is wired into
 * the NestJS service layer.
 *
 * @example
 * ```typescript
 * import { SocialPostManager } from '@framers/agentos/social-posting';
 *
 * const manager = new SocialPostManager();
 *
 * const post = manager.createDraft({
 *   seedId: 'agent-alpha',
 *   content: 'Hello world!',
 *   platforms: ['twitter', 'bluesky'],
 * });
 *
 * manager.schedulePost(post.id, '2026-03-05T12:00:00Z');
 * ```
 */
import { generateUUID } from '../../core/utils/uuid.js';
// ============================================================================
// Constants
// ============================================================================
/** Default maximum number of retry attempts before a post is permanently failed. */
const DEFAULT_MAX_RETRIES = 3;
// ============================================================================
// Valid State Transitions
// ============================================================================
/**
 * Allowed state transitions for the post lifecycle state machine.
 * Each key maps to the set of states it may transition to.
 */
const VALID_TRANSITIONS = {
    draft: ['scheduled', 'publishing'],
    scheduled: ['publishing'],
    publishing: ['published', 'error'],
    published: [],
    error: ['retry'],
    retry: ['publishing'],
};
// ============================================================================
// SocialPostManager
// ============================================================================
/**
 * Manages the lifecycle of social media posts.
 *
 * Provides create, schedule, publish, retry, and query operations over an
 * in-memory store. Platform-specific publishing is delegated to callers
 * (typically the ToolExecutor / skill layer) via the `publishNow`
 * callback mechanism.
 *
 * @example
 * ```typescript
 * const manager = new SocialPostManager();
 * const draft = manager.createDraft({
 *   seedId: 'my-agent',
 *   content: 'Big announcement!',
 *   platforms: ['twitter', 'linkedin'],
 * });
 *
 * // Schedule for later
 * manager.schedulePost(draft.id, '2026-03-10T15:00:00Z');
 *
 * // Or publish immediately
 * await manager.publishNow(draft.id);
 * ```
 */
export class SocialPostManager {
    constructor() {
        /** In-memory post store keyed by post ID. */
        this.posts = new Map();
    }
    // --------------------------------------------------------------------------
    // Configuration
    // --------------------------------------------------------------------------
    /**
     * Register a platform publish handler.
     *
     * The handler receives the full post and a single platform string and must
     * return a {@link SocialPostPlatformResult}. It is called once per platform
     * during `publishNow`.
     *
     * @param handler - Async function that publishes content to a platform
     */
    setPublishHandler(handler) {
        this.publishHandler = handler;
    }
    // --------------------------------------------------------------------------
    // Lifecycle Operations
    // --------------------------------------------------------------------------
    /**
     * Create a new draft post.
     *
     * If `input.schedule` is provided, the post is automatically transitioned
     * to 'scheduled' status.
     *
     * @param input - Draft creation parameters
     * @returns The newly created SocialPost in 'draft' (or 'scheduled') status
     */
    createDraft(input) {
        const now = new Date().toISOString();
        const post = {
            id: generateUUID(),
            seedId: input.seedId,
            baseContent: input.content,
            adaptations: input.adaptations ?? {},
            platforms: [...input.platforms],
            mediaUrls: input.mediaUrls ? [...input.mediaUrls] : undefined,
            scheduledAt: input.schedule,
            status: input.schedule ? 'scheduled' : 'draft',
            results: this.initPlatformResults(input.platforms),
            retryCount: 0,
            maxRetries: DEFAULT_MAX_RETRIES,
            createdAt: now,
            updatedAt: now,
        };
        this.posts.set(post.id, post);
        return { ...post };
    }
    /**
     * Schedule a draft post for future publishing.
     *
     * @param postId    - ID of the post to schedule
     * @param timestamp - ISO 8601 timestamp for desired publish time
     * @returns The updated SocialPost in 'scheduled' status
     * @throws {Error} If the post is not found or the transition is invalid
     */
    schedulePost(postId, timestamp) {
        const post = this.requirePost(postId);
        this.assertTransition(post.status, 'scheduled');
        post.scheduledAt = timestamp;
        post.status = 'scheduled';
        post.updatedAt = new Date().toISOString();
        return { ...post };
    }
    /**
     * Publish a post immediately.
     *
     * Transitions the post to 'publishing' and, if a publish handler is
     * registered, invokes it for each target platform. After all platform
     * results are collected, the post is transitioned to either 'published'
     * (all succeeded) or 'error' (any failure).
     *
     * If no publish handler is registered, the post remains in 'publishing'
     * status with all platform results set to 'pending'.
     *
     * @param postId - ID of the post to publish
     * @returns The updated SocialPost after publish attempts
     * @throws {Error} If the post is not found or the transition is invalid
     */
    async publishNow(postId) {
        const post = this.requirePost(postId);
        this.assertTransition(post.status, 'publishing');
        post.status = 'publishing';
        post.updatedAt = new Date().toISOString();
        if (!this.publishHandler) {
            return { ...post };
        }
        // Publish to each platform concurrently
        const platformResults = await Promise.allSettled(post.platforms.map(async (platform) => {
            try {
                const result = await this.publishHandler(post, platform);
                post.results[platform] = result;
                return result;
            }
            catch (err) {
                const errorResult = {
                    platform,
                    status: 'error',
                    error: err instanceof Error ? err.message : String(err),
                };
                post.results[platform] = errorResult;
                return errorResult;
            }
        }));
        // Determine aggregate status
        const allResults = Object.values(post.results);
        const hasError = allResults.some((r) => r.status === 'error');
        const allSuccess = allResults.every((r) => r.status === 'success');
        if (allSuccess) {
            post.status = 'published';
        }
        else if (hasError) {
            post.status = 'error';
        }
        post.updatedAt = new Date().toISOString();
        return { ...post };
    }
    /**
     * Record a platform-specific publish result.
     *
     * Used by external publish handlers to report results asynchronously
     * (e.g. webhook callbacks).
     *
     * @param postId   - ID of the post
     * @param platform - Platform identifier
     * @param result   - The platform result to record
     * @returns The updated SocialPost
     * @throws {Error} If the post is not found
     */
    markPlatformResult(postId, platform, result) {
        const post = this.requirePost(postId);
        post.results[platform] = result;
        // Auto-transition based on aggregate results
        const allResults = Object.values(post.results);
        const allSuccess = allResults.every((r) => r.status === 'success');
        const hasError = allResults.some((r) => r.status === 'error');
        const hasPending = allResults.some((r) => r.status === 'pending');
        if (allSuccess && !hasPending) {
            post.status = 'published';
        }
        else if (hasError && !hasPending) {
            post.status = 'error';
        }
        post.updatedAt = new Date().toISOString();
        return { ...post };
    }
    /**
     * Retry a failed post.
     *
     * Transitions the post from 'error' to 'retry', increments the retry
     * counter, and resets failed platform results to 'pending'.
     *
     * @param postId - ID of the post to retry
     * @returns The updated SocialPost in 'retry' status
     * @throws {Error} If the post is not found, the transition is invalid,
     *                 or the maximum retry count has been reached
     */
    retryFailed(postId) {
        const post = this.requirePost(postId);
        this.assertTransition(post.status, 'retry');
        if (post.retryCount >= post.maxRetries) {
            throw new Error(`Post ${postId} has exceeded maximum retries (${post.maxRetries})`);
        }
        post.status = 'retry';
        post.retryCount += 1;
        post.updatedAt = new Date().toISOString();
        // Reset failed platform results to pending for re-attempt
        for (const platform of post.platforms) {
            if (post.results[platform]?.status === 'error') {
                post.results[platform] = {
                    platform,
                    status: 'pending',
                };
            }
        }
        return { ...post };
    }
    // --------------------------------------------------------------------------
    // Query Operations
    // --------------------------------------------------------------------------
    /**
     * Retrieve a post by ID.
     *
     * @param postId - ID of the post to retrieve
     * @returns The SocialPost if found, otherwise undefined
     */
    getPost(postId) {
        const post = this.posts.get(postId);
        return post ? { ...post } : undefined;
    }
    /**
     * List posts with optional filtering by seed ID and/or status.
     *
     * @param seedId - Optional seed ID filter
     * @param status - Optional status filter
     * @returns Array of matching SocialPost objects
     */
    listPosts(seedId, status) {
        const results = [];
        for (const post of this.posts.values()) {
            if (seedId && post.seedId !== seedId)
                continue;
            if (status && post.status !== status)
                continue;
            results.push({ ...post });
        }
        return results;
    }
    /**
     * Get all scheduled posts whose scheduledAt timestamp has passed.
     *
     * Used by a polling loop or scheduler to find posts that are due for
     * publishing.
     *
     * @returns Array of SocialPost objects that are due for publishing
     */
    getDuePosts() {
        const now = new Date();
        const results = [];
        for (const post of this.posts.values()) {
            if (post.status === 'scheduled' && post.scheduledAt && new Date(post.scheduledAt) <= now) {
                results.push({ ...post });
            }
        }
        return results;
    }
    // --------------------------------------------------------------------------
    // Internal Helpers
    // --------------------------------------------------------------------------
    /**
     * Retrieve a post or throw if not found.
     */
    requirePost(postId) {
        const post = this.posts.get(postId);
        if (!post) {
            throw new Error(`Social post not found: ${postId}`);
        }
        return post;
    }
    /**
     * Assert that a state transition is valid.
     */
    assertTransition(current, target) {
        const allowed = VALID_TRANSITIONS[current];
        if (!allowed || !allowed.includes(target)) {
            throw new Error(`Invalid state transition: '${current}' --> '${target}'. ` +
                `Allowed transitions from '${current}': [${(allowed ?? []).join(', ')}]`);
        }
    }
    /**
     * Initialize platform results with 'pending' status for each platform.
     */
    initPlatformResults(platforms) {
        const results = {};
        for (const platform of platforms) {
            results[platform] = { platform, status: 'pending' };
        }
        return results;
    }
}
//# sourceMappingURL=SocialPostManager.js.map