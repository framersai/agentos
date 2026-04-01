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
/**
 * State machine states for a social post.
 *
 * Valid transitions:
 * - draft      --> scheduled | publishing
 * - scheduled  --> publishing
 * - publishing --> published | error
 * - error      --> retry
 * - retry      --> publishing
 */
export type SocialPostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'error' | 'retry';
/**
 * Per-platform publishing result tracked on a SocialPost.
 */
export interface SocialPostPlatformResult {
    /** Target platform identifier (e.g. 'twitter', 'bluesky'). */
    platform: string;
    /** Platform-assigned post ID after successful publish. */
    postId?: string;
    /** Canonical URL of the published post. */
    url?: string;
    /** Current status for this platform leg. */
    status: 'pending' | 'success' | 'error';
    /** Error message if status is 'error'. */
    error?: string;
    /** ISO 8601 timestamp of successful publish. */
    publishedAt?: string;
}
/**
 * A social post managed by the SocialPostManager.
 *
 * `adaptations` maps platform names to platform-specific content variants
 * produced by the ContentAdaptationEngine (or by the LLM skill layer).
 */
export interface SocialPost {
    /** Unique post identifier (UUID v4). */
    id: string;
    /** The agent seed this post belongs to. */
    seedId: string;
    /** The original, platform-agnostic content. */
    baseContent: string;
    /** Platform-specific content adaptations (platform --> adapted text). */
    adaptations: Record<string, string>;
    /** Target platforms for this post. */
    platforms: string[];
    /** Optional media attachment URLs. */
    mediaUrls?: string[];
    /** ISO 8601 timestamp when the post should be published. */
    scheduledAt?: string;
    /** Current lifecycle status. */
    status: SocialPostStatus;
    /** Per-platform publishing results. */
    results: Record<string, SocialPostPlatformResult>;
    /** Number of retry attempts so far. */
    retryCount: number;
    /** Maximum retry attempts before permanent failure. */
    maxRetries: number;
    /** ISO 8601 creation timestamp. */
    createdAt: string;
    /** ISO 8601 last-update timestamp. */
    updatedAt: string;
}
/**
 * Input for creating a new draft post.
 */
export interface CreateDraftInput {
    /** The agent seed this post belongs to. */
    seedId: string;
    /** The base content for the post. */
    content: string;
    /** Target platforms (e.g. ['twitter', 'linkedin']). */
    platforms: string[];
    /** Optional media attachment URLs. */
    mediaUrls?: string[];
    /** Pre-computed platform adaptations (platform --> adapted text). */
    adaptations?: Record<string, string>;
    /** ISO 8601 scheduled publish time. If omitted, the post stays as a draft. */
    schedule?: string;
}
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
export declare class SocialPostManager {
    /** In-memory post store keyed by post ID. */
    private readonly posts;
    /**
     * Optional publish handler injected by the consuming layer.
     * Called for each platform when `publishNow` is invoked.
     *
     * When not provided, publishNow will mark all platforms as 'pending'
     * and transition the post to 'publishing', leaving actual delivery
     * to the caller.
     */
    private publishHandler?;
    /**
     * Register a platform publish handler.
     *
     * The handler receives the full post and a single platform string and must
     * return a {@link SocialPostPlatformResult}. It is called once per platform
     * during `publishNow`.
     *
     * @param handler - Async function that publishes content to a platform
     */
    setPublishHandler(handler: (post: SocialPost, platform: string) => Promise<SocialPostPlatformResult>): void;
    /**
     * Create a new draft post.
     *
     * If `input.schedule` is provided, the post is automatically transitioned
     * to 'scheduled' status.
     *
     * @param input - Draft creation parameters
     * @returns The newly created SocialPost in 'draft' (or 'scheduled') status
     */
    createDraft(input: CreateDraftInput): SocialPost;
    /**
     * Schedule a draft post for future publishing.
     *
     * @param postId    - ID of the post to schedule
     * @param timestamp - ISO 8601 timestamp for desired publish time
     * @returns The updated SocialPost in 'scheduled' status
     * @throws {Error} If the post is not found or the transition is invalid
     */
    schedulePost(postId: string, timestamp: string): SocialPost;
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
    publishNow(postId: string): Promise<SocialPost>;
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
    markPlatformResult(postId: string, platform: string, result: SocialPostPlatformResult): SocialPost;
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
    retryFailed(postId: string): SocialPost;
    /**
     * Retrieve a post by ID.
     *
     * @param postId - ID of the post to retrieve
     * @returns The SocialPost if found, otherwise undefined
     */
    getPost(postId: string): SocialPost | undefined;
    /**
     * List posts with optional filtering by seed ID and/or status.
     *
     * @param seedId - Optional seed ID filter
     * @param status - Optional status filter
     * @returns Array of matching SocialPost objects
     */
    listPosts(seedId?: string, status?: SocialPostStatus): SocialPost[];
    /**
     * Get all scheduled posts whose scheduledAt timestamp has passed.
     *
     * Used by a polling loop or scheduler to find posts that are due for
     * publishing.
     *
     * @returns Array of SocialPost objects that are due for publishing
     */
    getDuePosts(): SocialPost[];
    /**
     * Retrieve a post or throw if not found.
     */
    private requirePost;
    /**
     * Assert that a state transition is valid.
     */
    private assertTransition;
    /**
     * Initialize platform results with 'pending' status for each platform.
     */
    private initPlatformResults;
}
//# sourceMappingURL=SocialPostManager.d.ts.map