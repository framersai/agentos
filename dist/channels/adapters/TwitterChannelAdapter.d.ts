/**
 * @fileoverview Twitter / X Channel Adapter for AgentOS.
 *
 * Wraps the Twitter API v2 to allow agents to post tweets, send DMs,
 * and interact with the Twitter platform. Uses the `twitter-api-v2`
 * npm package via dynamic import.
 *
 * **Rate limiting** is a critical concern for Twitter. The adapter
 * tracks remaining rate-limit budget from response headers and will
 * queue or reject requests when the budget is exhausted. A sliding
 * window ensures the agent does not trip 429 responses.
 *
 * **Dependencies**: Requires `twitter-api-v2` to be installed.
 *
 * @example
 * ```typescript
 * const twitter = new TwitterChannelAdapter();
 * await twitter.initialize({
 *   platform: 'twitter',
 *   credential: '<bearer_token>',
 *   params: {
 *     apiKey: 'consumer-key',
 *     apiSecret: 'consumer-secret',
 *     accessToken: 'user-access-token',
 *     accessSecret: 'user-access-token-secret',
 *   },
 * });
 * ```
 *
 * @module @framers/agentos/channels/adapters/TwitterChannelAdapter
 */
import type { ChannelAuthConfig, ChannelCapability, ChannelPlatform, ChannelSendResult, MessageContent } from '../types.js';
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
/** Platform-specific authentication parameters for Twitter API v2. */
export interface TwitterAuthParams extends Record<string, string | undefined> {
    /** Consumer / API key. */
    apiKey: string;
    /** Consumer / API secret. */
    apiSecret: string;
    /** User-level access token for read/write operations. */
    accessToken: string;
    /** User-level access token secret. */
    accessSecret: string;
}
/**
 * Channel adapter for Twitter / X.
 *
 * Uses the `twitter-api-v2` package via dynamic import so the
 * dependency is optional -- it is only loaded at connection time.
 *
 * Capabilities: `text`, `images`, `video`, `hashtags`, `mentions`,
 * `threads`, `reactions`, `polls`.
 */
export declare class TwitterChannelAdapter extends BaseChannelAdapter<TwitterAuthParams> {
    readonly platform: ChannelPlatform;
    readonly displayName = "Twitter / X";
    readonly capabilities: readonly ChannelCapability[];
    private client;
    private rwClient;
    /** Authenticated user info. */
    private authenticatedUser;
    /** Rate-limit tracking per endpoint group. */
    private rateLimits;
    /** Polling interval for mentions/DMs (ms). */
    private pollTimer;
    private lastMentionId;
    private lastDmEventId;
    protected doConnect(auth: ChannelAuthConfig & {
        params?: TwitterAuthParams;
    }): Promise<void>;
    protected doSendMessage(conversationId: string, content: MessageContent): Promise<ChannelSendResult>;
    protected doShutdown(): Promise<void>;
    /**
     * Post a tweet (public timeline post).
     *
     * @param content - Message content to tweet.
     * @param replyToTweetId - If provided, the tweet will be a reply in a thread.
     */
    postTweet(content: MessageContent, replyToTweetId?: string): Promise<ChannelSendResult>;
    /**
     * Post a thread (sequence of connected tweets).
     */
    postThread(tweets: MessageContent[]): Promise<ChannelSendResult[]>;
    /**
     * Like (favorite) a tweet.
     */
    likeTweet(tweetId: string): Promise<void>;
    /**
     * Retweet a tweet.
     */
    retweet(tweetId: string): Promise<void>;
    /**
     * Get the authenticated user information.
     */
    getAuthenticatedUser(): {
        id: string;
        username: string;
        name: string;
    } | undefined;
    private sendDirectMessage;
    private uploadMediaFromBlocks;
    private extractText;
    private hasMediaBlocks;
    /**
     * Truncate text to fit Twitter's character limit.
     * If truncation is needed, append an ellipsis.
     */
    private truncateToLimit;
    private checkRateLimit;
    private updateRateLimit;
    private handleApiError;
    private startPolling;
    private stopPolling;
    private pollMentions;
    private pollDirectMessages;
}
//# sourceMappingURL=TwitterChannelAdapter.d.ts.map