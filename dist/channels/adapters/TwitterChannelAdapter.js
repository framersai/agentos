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
import { BaseChannelAdapter } from './BaseChannelAdapter.js';
// ============================================================================
// TwitterChannelAdapter
// ============================================================================
/**
 * Channel adapter for Twitter / X.
 *
 * Uses the `twitter-api-v2` package via dynamic import so the
 * dependency is optional -- it is only loaded at connection time.
 *
 * Capabilities: `text`, `images`, `video`, `hashtags`, `mentions`,
 * `threads`, `reactions`, `polls`.
 */
export class TwitterChannelAdapter extends BaseChannelAdapter {
    constructor() {
        super(...arguments);
        this.platform = 'twitter';
        this.displayName = 'Twitter / X';
        this.capabilities = [
            'text',
            'images',
            'video',
            'hashtags',
            'mentions',
            'threads',
            'reactions',
            'polls',
        ];
        /** Rate-limit tracking per endpoint group. */
        this.rateLimits = new Map();
    }
    // ── Abstract hook implementations ──
    async doConnect(auth) {
        // Dynamic import
        let TwitterApi; // eslint-disable-line @typescript-eslint/no-explicit-any
        try {
            const mod = await import('twitter-api-v2');
            TwitterApi = mod.TwitterApi ?? mod.default?.TwitterApi ?? mod.default;
        }
        catch {
            throw new Error('The "twitter-api-v2" package is required for the Twitter adapter. ' +
                'Install it with: npm install twitter-api-v2');
        }
        const params = auth.params ?? {};
        if (!params.apiKey || !params.apiSecret) {
            throw new Error('Twitter auth params must include "apiKey" and "apiSecret".');
        }
        if (!params.accessToken || !params.accessSecret) {
            throw new Error('Twitter auth params must include "accessToken" and "accessSecret".');
        }
        // Create the client with user-context OAuth 1.0a credentials
        this.client = new TwitterApi({
            appKey: params.apiKey,
            appSecret: params.apiSecret,
            accessToken: params.accessToken,
            accessSecret: params.accessSecret,
        });
        // Get the read-write client
        this.rwClient = this.client.readWrite;
        // Verify credentials by fetching the authenticated user
        try {
            const me = await this.rwClient.v2.me({
                'user.fields': ['id', 'username', 'name', 'profile_image_url'],
            });
            this.authenticatedUser = {
                id: me.data.id,
                username: me.data.username,
                name: me.data.name,
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Twitter credential verification failed: ${message}`);
        }
        // Populate platform info
        this.platformInfo = {
            userId: this.authenticatedUser.id,
            username: this.authenticatedUser.username,
            displayName: this.authenticatedUser.name,
        };
        // Start polling for mentions and DMs
        this.startPolling();
    }
    async doSendMessage(conversationId, content) {
        if (!this.rwClient) {
            throw new Error('[Twitter] Client is not connected.');
        }
        // Determine if this is a DM or a tweet
        // Convention: conversationId starting with "dm:" indicates a DM target user ID
        const isDm = conversationId.startsWith('dm:');
        if (isDm) {
            return this.sendDirectMessage(conversationId.slice(3), content);
        }
        return this.postTweet(content, conversationId);
    }
    async doShutdown() {
        this.stopPolling();
        this.client = undefined;
        this.rwClient = undefined;
        this.authenticatedUser = undefined;
        this.rateLimits.clear();
        this.lastMentionId = undefined;
        this.lastDmEventId = undefined;
    }
    // ── Twitter-specific public methods ──
    /**
     * Post a tweet (public timeline post).
     *
     * @param content - Message content to tweet.
     * @param replyToTweetId - If provided, the tweet will be a reply in a thread.
     */
    async postTweet(content, replyToTweetId) {
        await this.checkRateLimit('tweets');
        const text = this.extractText(content.blocks);
        if (!text && !this.hasMediaBlocks(content.blocks)) {
            throw new Error('[Twitter] Cannot post empty tweet.');
        }
        // Build tweet payload
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tweetPayload = {};
        if (text) {
            tweetPayload.text = this.truncateToLimit(text, 280);
        }
        // Handle reply threading
        const replyTo = replyToTweetId || content.replyToMessageId;
        if (replyTo) {
            tweetPayload.reply = { in_reply_to_tweet_id: replyTo };
        }
        // Handle poll content blocks
        const pollBlock = content.blocks.find((b) => b.type === 'poll');
        if (pollBlock && pollBlock.type === 'poll') {
            tweetPayload.poll = {
                options: pollBlock.options.slice(0, 4), // Twitter max 4 options
                duration_minutes: (pollBlock.durationHours ?? 24) * 60,
            };
        }
        // Upload media if present
        const mediaIds = await this.uploadMediaFromBlocks(content.blocks);
        if (mediaIds.length > 0) {
            tweetPayload.media = { media_ids: mediaIds.slice(0, 4) }; // Max 4 media per tweet
        }
        try {
            const result = await this.rwClient.v2.tweet(tweetPayload);
            this.updateRateLimit('tweets', result);
            return {
                messageId: result.data.id,
                timestamp: new Date().toISOString(),
            };
        }
        catch (err) {
            this.handleApiError(err, 'tweet');
            throw err; // re-throw after handling
        }
    }
    /**
     * Post a thread (sequence of connected tweets).
     */
    async postThread(tweets) {
        const results = [];
        let lastTweetId;
        for (const tweet of tweets) {
            if (lastTweetId) {
                tweet.replyToMessageId = lastTweetId;
            }
            const result = await this.postTweet(tweet, lastTweetId);
            results.push(result);
            lastTweetId = result.messageId;
        }
        return results;
    }
    /**
     * Like (favorite) a tweet.
     */
    async likeTweet(tweetId) {
        if (!this.rwClient || !this.authenticatedUser) {
            throw new Error('[Twitter] Client is not connected.');
        }
        await this.checkRateLimit('likes');
        try {
            await this.rwClient.v2.like(this.authenticatedUser.id, tweetId);
        }
        catch (err) {
            this.handleApiError(err, 'like');
            throw err;
        }
    }
    /**
     * Retweet a tweet.
     */
    async retweet(tweetId) {
        if (!this.rwClient || !this.authenticatedUser) {
            throw new Error('[Twitter] Client is not connected.');
        }
        await this.checkRateLimit('retweets');
        try {
            await this.rwClient.v2.retweet(this.authenticatedUser.id, tweetId);
        }
        catch (err) {
            this.handleApiError(err, 'retweet');
            throw err;
        }
    }
    /**
     * Get the authenticated user information.
     */
    getAuthenticatedUser() {
        return this.authenticatedUser ? { ...this.authenticatedUser } : undefined;
    }
    // ── Private helpers ──
    async sendDirectMessage(recipientUserId, content) {
        await this.checkRateLimit('dm');
        const text = this.extractText(content.blocks);
        if (!text) {
            throw new Error('[Twitter] DM text content is required.');
        }
        try {
            const result = await this.rwClient.v2.sendDmInConversation(recipientUserId, { text });
            return {
                messageId: result.data?.dm_event_id ?? `dm-${Date.now()}`,
                timestamp: new Date().toISOString(),
            };
        }
        catch (err) {
            // Fallback: try creating a new DM conversation
            try {
                const result = await this.rwClient.v2.sendDmToParticipant(recipientUserId, { text });
                return {
                    messageId: result.data?.dm_event_id ?? `dm-${Date.now()}`,
                    timestamp: new Date().toISOString(),
                };
            }
            catch (innerErr) {
                this.handleApiError(innerErr, 'dm');
                throw innerErr;
            }
        }
    }
    async uploadMediaFromBlocks(blocks) {
        const mediaIds = [];
        for (const block of blocks) {
            if (block.type === 'image' || block.type === 'video') {
                try {
                    // twitter-api-v2 supports uploading from URL via v1.1 media upload
                    const mediaId = await this.rwClient.v1.uploadMedia(block.url, {
                        mimeType: block.mimeType,
                    });
                    mediaIds.push(mediaId);
                }
                catch (err) {
                    console.warn(`[Twitter] Failed to upload media: ${err}`);
                    // Non-fatal: skip this media block
                }
            }
        }
        return mediaIds;
    }
    extractText(blocks) {
        const textParts = [];
        for (const block of blocks) {
            if (block.type === 'text') {
                textParts.push(block.text);
            }
        }
        return textParts.join('\n');
    }
    hasMediaBlocks(blocks) {
        return blocks.some((b) => b.type === 'image' || b.type === 'video');
    }
    /**
     * Truncate text to fit Twitter's character limit.
     * If truncation is needed, append an ellipsis.
     */
    truncateToLimit(text, limit) {
        if (text.length <= limit)
            return text;
        return text.slice(0, limit - 1) + '\u2026';
    }
    // ── Rate limiting ──
    async checkRateLimit(bucket) {
        const limit = this.rateLimits.get(bucket);
        if (!limit)
            return; // No data yet — allow the request
        const now = Math.floor(Date.now() / 1000);
        if (limit.remaining <= 0 && now < limit.resetAt) {
            const waitMs = (limit.resetAt - now) * 1000 + 1000; // +1s buffer
            console.warn(`[Twitter] Rate limit exhausted for "${bucket}". ` +
                `Waiting ${Math.round(waitMs / 1000)}s until reset.`);
            if (waitMs > 60000) {
                throw new Error(`[Twitter] Rate limit for "${bucket}" resets in ${Math.round(waitMs / 1000)}s. ` +
                    'Request rejected to avoid excessive wait.');
            }
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateRateLimit(bucket, apiResponse) {
        // twitter-api-v2 includes rate limit info in the response headers
        // when available. The shape depends on the endpoint.
        try {
            const rateLimit = apiResponse?.rateLimit;
            if (rateLimit) {
                this.rateLimits.set(bucket, {
                    remaining: rateLimit.remaining ?? 0,
                    resetAt: rateLimit.reset ?? Math.floor(Date.now() / 1000) + 900,
                });
            }
        }
        catch {
            // Non-fatal — rate limit tracking is best-effort
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleApiError(err, operation) {
        // Check for rate limit errors (HTTP 429)
        if (err?.code === 429 || err?.rateLimitError) {
            const resetAt = err?.rateLimit?.reset ?? Math.floor(Date.now() / 1000) + 900;
            this.rateLimits.set(operation, { remaining: 0, resetAt });
            console.error(`[Twitter] Rate limited on "${operation}". Resets at ${new Date(resetAt * 1000).toISOString()}.`);
        }
        else {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[Twitter] API error during "${operation}": ${message}`);
        }
    }
    // ── Polling for inbound events ──
    startPolling() {
        // Poll every 60 seconds for mentions and DMs
        // Twitter API v2 free tier has very limited polling budget
        this.pollTimer = setInterval(() => {
            this.pollMentions().catch((err) => {
                console.warn('[Twitter] Mention poll error:', err);
            });
            this.pollDirectMessages().catch((err) => {
                console.warn('[Twitter] DM poll error:', err);
            });
        }, 60000);
    }
    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }
    async pollMentions() {
        if (!this.rwClient || !this.authenticatedUser)
            return;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const params = {
                'tweet.fields': ['created_at', 'author_id', 'conversation_id', 'in_reply_to_user_id'],
                'user.fields': ['username', 'name', 'profile_image_url'],
                expansions: ['author_id'],
                max_results: 10,
            };
            if (this.lastMentionId) {
                params.since_id = this.lastMentionId;
            }
            const mentions = await this.rwClient.v2.userMentionTimeline(this.authenticatedUser.id, params);
            if (!mentions?.data?.data)
                return;
            // Build a user lookup from includes
            const usersMap = new Map();
            if (mentions.data.includes?.users) {
                for (const u of mentions.data.includes.users) {
                    usersMap.set(u.id, { username: u.username, name: u.name });
                }
            }
            for (const tweet of mentions.data.data) {
                const user = usersMap.get(tweet.author_id) ?? {
                    username: 'unknown',
                    name: 'Unknown',
                };
                const message = {
                    messageId: tweet.id,
                    platform: 'twitter',
                    conversationId: tweet.conversation_id ?? tweet.id,
                    conversationType: 'channel', // Public timeline
                    sender: {
                        id: tweet.author_id,
                        displayName: user.name,
                        username: user.username,
                    },
                    content: [{ type: 'text', text: tweet.text }],
                    text: tweet.text,
                    timestamp: tweet.created_at ?? new Date().toISOString(),
                    replyToMessageId: tweet.in_reply_to_user_id ? tweet.conversation_id : undefined,
                    rawEvent: tweet,
                };
                this.emit({
                    type: 'message',
                    platform: 'twitter',
                    conversationId: message.conversationId,
                    timestamp: message.timestamp,
                    data: message,
                });
                // Track the latest mention ID for pagination
                if (!this.lastMentionId || tweet.id > this.lastMentionId) {
                    this.lastMentionId = tweet.id;
                }
            }
        }
        catch (err) {
            // Non-fatal — will retry on next poll
            this.handleApiError(err, 'mentions_poll');
        }
    }
    async pollDirectMessages() {
        if (!this.rwClient || !this.authenticatedUser)
            return;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const params = {
                'dm_event.fields': ['created_at', 'sender_id', 'dm_conversation_id', 'text', 'attachments'],
                max_results: 10,
            };
            const events = await this.rwClient.v2.listDmEvents(params);
            if (!events?.data?.data)
                return;
            for (const dmEvent of events.data.data) {
                // Skip our own messages
                if (dmEvent.sender_id === this.authenticatedUser?.id)
                    continue;
                // Skip already-processed events
                if (this.lastDmEventId && dmEvent.id <= this.lastDmEventId)
                    continue;
                const message = {
                    messageId: dmEvent.id,
                    platform: 'twitter',
                    conversationId: `dm:${dmEvent.dm_conversation_id ?? dmEvent.sender_id}`,
                    conversationType: 'direct',
                    sender: {
                        id: dmEvent.sender_id,
                        username: dmEvent.sender_id, // Would need a user lookup for username
                    },
                    content: [{ type: 'text', text: dmEvent.text ?? '' }],
                    text: dmEvent.text ?? '',
                    timestamp: dmEvent.created_at ?? new Date().toISOString(),
                    rawEvent: dmEvent,
                };
                this.emit({
                    type: 'message',
                    platform: 'twitter',
                    conversationId: message.conversationId,
                    timestamp: message.timestamp,
                    data: message,
                });
                if (!this.lastDmEventId || dmEvent.id > this.lastDmEventId) {
                    this.lastDmEventId = dmEvent.id;
                }
            }
        }
        catch (err) {
            // Non-fatal — will retry on next poll
            this.handleApiError(err, 'dm_poll');
        }
    }
}
//# sourceMappingURL=TwitterChannelAdapter.js.map