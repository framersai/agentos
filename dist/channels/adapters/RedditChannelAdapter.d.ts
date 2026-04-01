/**
 * @fileoverview Reddit Channel Adapter for AgentOS.
 *
 * Wraps the Reddit API (via `snoowrap`) to allow agents to submit
 * posts, comments, and interact with subreddits. Uses dynamic import
 * so that `snoowrap` is only loaded at connection time.
 *
 * Reddit's API has strict rate limits (60 requests per minute for
 * OAuth apps). The adapter tracks and respects these limits with a
 * request queue.
 *
 * **Dependencies**: Requires `snoowrap` to be installed.
 *
 * @example
 * ```typescript
 * const reddit = new RedditChannelAdapter();
 * await reddit.initialize({
 *   platform: 'reddit',
 *   credential: '<client_id>',
 *   params: {
 *     clientSecret: 'your-client-secret',
 *     username: 'bot_username',
 *     password: 'bot_password',
 *     userAgent: 'agentos:v1.0 (by /u/your_username)',
 *   },
 * });
 * ```
 *
 * @module @framers/agentos/channels/adapters/RedditChannelAdapter
 */
import type { ChannelAuthConfig, ChannelCapability, ChannelPlatform, ChannelSendResult, MessageContent } from '../types.js';
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
/** Platform-specific authentication parameters for Reddit. */
export interface RedditAuthParams extends Record<string, string | undefined> {
    /** OAuth2 client secret. */
    clientSecret: string;
    /** Reddit account username for the bot. */
    username: string;
    /** Reddit account password for the bot. */
    password: string;
    /** User-Agent string (required by Reddit API TOS). */
    userAgent: string;
}
/**
 * Channel adapter for Reddit.
 *
 * Uses the `snoowrap` package via dynamic import so the dependency
 * is optional. Falls back to raw `fetch` against the Reddit OAuth2
 * API if snoowrap is unavailable.
 *
 * Capabilities: `text`, `rich_text`, `images`, `video`, `reactions`,
 * `threads`, `group_chat`, `hashtags`, `polls`.
 *
 * Conversation ID mapping:
 * - Subreddit post: `r/<subreddit>` or `post:<thing_id>`
 * - Comment reply: `comment:<thing_id>`
 * - Direct message: `dm:<username>`
 */
export declare class RedditChannelAdapter extends BaseChannelAdapter<RedditAuthParams> {
    readonly platform: ChannelPlatform;
    readonly displayName = "Reddit";
    readonly capabilities: readonly ChannelCapability[];
    private client;
    /** Whether we're using snoowrap or raw fetch. */
    private usingSnoowrap;
    /** OAuth2 access token for raw fetch fallback. */
    private accessToken;
    private tokenExpiresAt;
    private storedAuth;
    /** Authenticated user info. */
    private authenticatedUser;
    /** Rate-limit: requests remaining in the current window. */
    private rateLimitRemaining;
    private rateLimitResetAt;
    /** Polling interval for inbox messages. */
    private pollTimer;
    private lastInboxTimestamp;
    protected doConnect(auth: ChannelAuthConfig & {
        params?: RedditAuthParams;
    }): Promise<void>;
    protected doSendMessage(conversationId: string, content: MessageContent): Promise<ChannelSendResult>;
    protected doShutdown(): Promise<void>;
    /**
     * Submit a new post to a subreddit.
     */
    submitPost(subreddit: string, content: MessageContent): Promise<ChannelSendResult>;
    /**
     * Upvote a post or comment.
     */
    upvote(thingId: string): Promise<void>;
    /**
     * Downvote a post or comment.
     */
    downvote(thingId: string): Promise<void>;
    /**
     * Get information about the authenticated user.
     */
    getAuthenticatedUser(): {
        name: string;
        id: string;
    } | undefined;
    private submitPostSnoowrap;
    private replyToComment;
    private replyToPost;
    private sendPrivateMessage;
    private authenticateRaw;
    private ensureAccessToken;
    private redditApiRequest;
    private submitPostRaw;
    private startPolling;
    private stopPolling;
    private pollInbox;
    private extractText;
    /**
     * Extract the first line as a title. Reddit requires titles for posts.
     */
    private extractTitle;
    /**
     * Extract everything after the first line as the body.
     */
    private extractBody;
}
//# sourceMappingURL=RedditChannelAdapter.d.ts.map