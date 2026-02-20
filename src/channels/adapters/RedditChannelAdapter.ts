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

import type {
  ChannelAuthConfig,
  ChannelCapability,
  ChannelMessage,
  ChannelPlatform,
  ChannelSendResult,
  MessageContent,
  MessageContentBlock,
} from '../types.js';
import { BaseChannelAdapter } from './BaseChannelAdapter.js';

// ============================================================================
// Reddit Auth Params
// ============================================================================

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

// ============================================================================
// RedditChannelAdapter
// ============================================================================

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
export class RedditChannelAdapter extends BaseChannelAdapter<RedditAuthParams> {
  readonly platform: ChannelPlatform = 'reddit';
  readonly displayName = 'Reddit';
  readonly capabilities: readonly ChannelCapability[] = [
    'text',
    'rich_text',
    'images',
    'video',
    'reactions',
    'threads',
    'group_chat',
    'hashtags',
    'polls',
  ] as const;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any | undefined;

  /** Whether we're using snoowrap or raw fetch. */
  private usingSnoowrap = false;

  /** OAuth2 access token for raw fetch fallback. */
  private accessToken: string | undefined;
  private tokenExpiresAt = 0;
  private storedAuth: (ChannelAuthConfig & { params?: RedditAuthParams }) | undefined;

  /** Authenticated user info. */
  private authenticatedUser: { name: string; id: string } | undefined;

  /** Rate-limit: requests remaining in the current window. */
  private rateLimitRemaining = 60;
  private rateLimitResetAt = 0;

  /** Polling interval for inbox messages. */
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private lastInboxTimestamp = 0;

  // ── Abstract hook implementations ──

  protected async doConnect(
    auth: ChannelAuthConfig & { params?: RedditAuthParams },
  ): Promise<void> {
    const params = auth.params ?? ({} as RedditAuthParams);
    this.storedAuth = auth;

    if (!auth.credential) {
      throw new Error('Reddit auth credential (clientId) is required.');
    }
    if (!params.clientSecret) {
      throw new Error('Reddit auth params must include "clientSecret".');
    }
    if (!params.username || !params.password) {
      throw new Error('Reddit auth params must include "username" and "password".');
    }
    if (!params.userAgent) {
      throw new Error('Reddit auth params must include "userAgent".');
    }

    // Attempt snoowrap first, fall back to raw fetch
    try {
      const snoowrap = await import('snoowrap');
      const Snoowrap = snoowrap.default ?? snoowrap;

      this.client = new Snoowrap({
        userAgent: params.userAgent,
        clientId: auth.credential,
        clientSecret: params.clientSecret,
        username: params.username,
        password: params.password,
      });

      // Configure snoowrap rate limiting
      this.client.config({
        requestDelay: 1000, // 1 request per second baseline
        continueAfterRatelimitError: true,
        retryErrorCodes: [502, 503, 504, 522],
        maxRetryAttempts: 3,
      });

      this.usingSnoowrap = true;

      // Verify by fetching the authenticated user
      const me = await this.client.getMe();
      this.authenticatedUser = {
        name: me.name,
        id: me.id,
      };
    } catch (importErr) {
      // snoowrap not available — use raw Reddit API
      console.warn(
        '[Reddit] snoowrap not installed, using raw Reddit API. ' +
          'Install snoowrap for a richer experience: npm install snoowrap',
      );

      this.usingSnoowrap = false;
      await this.authenticateRaw(auth.credential, params);
    }

    this.platformInfo = {
      username: this.authenticatedUser?.name,
      userId: this.authenticatedUser?.id,
      usingSnoowrap: this.usingSnoowrap,
    };

    // Start polling for incoming messages
    this.startPolling();
  }

  protected async doSendMessage(
    conversationId: string,
    content: MessageContent,
  ): Promise<ChannelSendResult> {
    // Determine what kind of interaction this is
    if (conversationId.startsWith('r/')) {
      return this.submitPost(conversationId.slice(2), content);
    }

    if (conversationId.startsWith('comment:')) {
      return this.replyToComment(conversationId.slice(8), content);
    }

    if (conversationId.startsWith('post:')) {
      return this.replyToPost(conversationId.slice(5), content);
    }

    if (conversationId.startsWith('dm:')) {
      return this.sendPrivateMessage(conversationId.slice(3), content);
    }

    // Default: treat as subreddit name
    return this.submitPost(conversationId, content);
  }

  protected async doShutdown(): Promise<void> {
    this.stopPolling();
    this.client = undefined;
    this.accessToken = undefined;
    this.authenticatedUser = undefined;
    this.storedAuth = undefined;
    this.lastInboxTimestamp = 0;
  }

  // ── Reddit-specific public methods ──

  /**
   * Submit a new post to a subreddit.
   */
  async submitPost(
    subreddit: string,
    content: MessageContent,
  ): Promise<ChannelSendResult> {
    const text = this.extractText(content.blocks);
    const title = this.extractTitle(text);
    const body = this.extractBody(text);
    const imageBlock = content.blocks.find((b) => b.type === 'image');
    const pollBlock = content.blocks.find((b) => b.type === 'poll');

    if (this.usingSnoowrap && this.client) {
      return this.submitPostSnoowrap(subreddit, title, body, imageBlock, pollBlock);
    }

    return this.submitPostRaw(subreddit, title, body, imageBlock);
  }

  /**
   * Upvote a post or comment.
   */
  async upvote(thingId: string): Promise<void> {
    if (this.usingSnoowrap && this.client) {
      await this.client.getSubmission(thingId).upvote();
    } else {
      await this.redditApiRequest('POST', '/api/vote', {
        id: thingId,
        dir: 1,
      });
    }
  }

  /**
   * Downvote a post or comment.
   */
  async downvote(thingId: string): Promise<void> {
    if (this.usingSnoowrap && this.client) {
      await this.client.getSubmission(thingId).downvote();
    } else {
      await this.redditApiRequest('POST', '/api/vote', {
        id: thingId,
        dir: -1,
      });
    }
  }

  /**
   * Get information about the authenticated user.
   */
  getAuthenticatedUser(): { name: string; id: string } | undefined {
    return this.authenticatedUser ? { ...this.authenticatedUser } : undefined;
  }

  // ── Private: snoowrap methods ──

  private async submitPostSnoowrap(
    subreddit: string,
    title: string,
    body: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    imageBlock: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pollBlock: any,
  ): Promise<ChannelSendResult> {
    let submission: any; // eslint-disable-line @typescript-eslint/no-explicit-any

    if (imageBlock && imageBlock.type === 'image') {
      // Link post with image URL
      submission = await this.client
        .getSubreddit(subreddit)
        .submitLink({
          title,
          url: imageBlock.url,
        });
    } else if (pollBlock && pollBlock.type === 'poll') {
      // Polls require raw API call even with snoowrap
      const result = await this.redditApiRequest('POST', '/api/submit_poll_post', {
        sr: subreddit,
        title,
        selftext: body,
        options: pollBlock.options,
        duration: (pollBlock.durationHours ?? 24) * 60, // minutes
      });
      return {
        messageId: result?.json?.data?.id ?? `reddit-${Date.now()}`,
        timestamp: new Date().toISOString(),
      };
    } else {
      // Self (text) post
      submission = await this.client
        .getSubreddit(subreddit)
        .submitSelfpost({
          title,
          text: body,
        });
    }

    return {
      messageId: submission?.name ?? submission?.id ?? `reddit-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
  }

  private async replyToComment(
    commentId: string,
    content: MessageContent,
  ): Promise<ChannelSendResult> {
    const text = this.extractText(content.blocks);
    if (!text) {
      throw new Error('[Reddit] Cannot post empty comment.');
    }

    if (this.usingSnoowrap && this.client) {
      const reply = await this.client.getComment(commentId).reply(text);
      return {
        messageId: reply?.name ?? reply?.id ?? `reddit-${Date.now()}`,
        timestamp: new Date().toISOString(),
      };
    }

    const result = await this.redditApiRequest('POST', '/api/comment', {
      parent: commentId.startsWith('t1_') ? commentId : `t1_${commentId}`,
      text,
    });

    return {
      messageId: result?.json?.data?.things?.[0]?.data?.name ?? `reddit-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
  }

  private async replyToPost(
    postId: string,
    content: MessageContent,
  ): Promise<ChannelSendResult> {
    const text = this.extractText(content.blocks);
    if (!text) {
      throw new Error('[Reddit] Cannot post empty comment.');
    }

    if (this.usingSnoowrap && this.client) {
      const reply = await this.client.getSubmission(postId).reply(text);
      return {
        messageId: reply?.name ?? reply?.id ?? `reddit-${Date.now()}`,
        timestamp: new Date().toISOString(),
      };
    }

    const result = await this.redditApiRequest('POST', '/api/comment', {
      parent: postId.startsWith('t3_') ? postId : `t3_${postId}`,
      text,
    });

    return {
      messageId: result?.json?.data?.things?.[0]?.data?.name ?? `reddit-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
  }

  private async sendPrivateMessage(
    username: string,
    content: MessageContent,
  ): Promise<ChannelSendResult> {
    const text = this.extractText(content.blocks);
    const title = this.extractTitle(text);
    const body = this.extractBody(text);

    if (this.usingSnoowrap && this.client) {
      await this.client.composeMessage({
        to: username,
        subject: title || 'Message from AgentOS',
        text: body || text,
      });
    } else {
      await this.redditApiRequest('POST', '/api/compose', {
        to: username,
        subject: title || 'Message from AgentOS',
        text: body || text,
      });
    }

    return {
      messageId: `dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Private: raw Reddit API (fetch-based fallback) ──

  private async authenticateRaw(
    clientId: string,
    params: RedditAuthParams,
  ): Promise<void> {
    const basicAuth = Buffer.from(`${clientId}:${params.clientSecret}`).toString('base64');

    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': params.userAgent,
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: params.username,
        password: params.password,
      }),
    });

    if (!response.ok) {
      throw new Error(`Reddit OAuth2 authentication failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`Reddit OAuth2 error: ${data.error}`);
    }

    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;

    // Fetch authenticated user info
    const meResponse = await this.redditApiRequest('GET', '/api/v1/me');
    this.authenticatedUser = {
      name: meResponse.name,
      id: meResponse.id,
    };
  }

  private async ensureAccessToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return; // Token still valid (with 60s buffer)
    }

    if (!this.storedAuth) {
      throw new Error('[Reddit] Cannot refresh token — no stored auth.');
    }

    const params = this.storedAuth.params ?? ({} as RedditAuthParams);
    await this.authenticateRaw(this.storedAuth.credential, params);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async redditApiRequest(method: string, path: string, body?: any): Promise<any> {
    if (!this.usingSnoowrap) {
      await this.ensureAccessToken();
    }

    // Respect rate limits
    const now = Date.now() / 1000;
    if (this.rateLimitRemaining <= 1 && now < this.rateLimitResetAt) {
      const waitMs = (this.rateLimitResetAt - now) * 1000 + 500;
      console.warn(`[Reddit] Rate limit near exhaustion. Waiting ${Math.round(waitMs / 1000)}s.`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const url = `https://oauth.reddit.com${path}`;
    const userAgent = this.storedAuth?.params?.userAgent ?? 'AgentOS Reddit Adapter';

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'User-Agent': userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    };

    if (body && method !== 'GET') {
      options.body = new URLSearchParams(
        Object.entries(body).reduce<Record<string, string>>((acc, [k, v]) => {
          acc[k] = typeof v === 'string' ? v : JSON.stringify(v);
          return acc;
        }, {}),
      );
    }

    const response = await fetch(url, options);

    // Update rate limit tracking from headers
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    if (remaining !== null) {
      this.rateLimitRemaining = parseFloat(remaining);
    }
    if (reset !== null) {
      this.rateLimitResetAt = Date.now() / 1000 + parseFloat(reset);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Reddit API error: ${response.status} ${response.statusText} — ${text}`);
    }

    return response.json();
  }

  // ── Private: submit post via raw API ──

  private async submitPostRaw(
    subreddit: string,
    title: string,
    body: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    imageBlock: any,
  ): Promise<ChannelSendResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      sr: subreddit,
      title,
      kind: imageBlock ? 'link' : 'self',
      resubmit: 'true',
    };

    if (imageBlock && imageBlock.type === 'image') {
      payload.url = imageBlock.url;
    } else {
      payload.text = body;
    }

    const result = await this.redditApiRequest('POST', '/api/submit', payload);

    return {
      messageId: result?.json?.data?.name ?? result?.json?.data?.id ?? `reddit-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Polling for inbox messages ──

  private startPolling(): void {
    // Poll inbox every 90 seconds (conservative for Reddit rate limits)
    this.pollTimer = setInterval(() => {
      this.pollInbox().catch((err) => {
        console.warn('[Reddit] Inbox poll error:', err);
      });
    }, 90_000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async pollInbox(): Promise<void> {
    try {
      let messages: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any

      if (this.usingSnoowrap && this.client) {
        const inbox = await this.client.getUnreadMessages();
        messages = Array.isArray(inbox) ? inbox : [];
      } else {
        const result = await this.redditApiRequest('GET', '/message/unread?limit=25');
        messages = result?.data?.children?.map((c: any) => c.data) ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
      }

      for (const msg of messages) {
        const createdAt = (msg.created_utc ?? msg.created ?? 0) * 1000;
        if (createdAt <= this.lastInboxTimestamp) continue;

        const isComment = msg.was_comment === true;
        const conversationId = isComment
          ? `comment:${msg.name ?? msg.id}`
          : `dm:${msg.author ?? msg.dest ?? 'unknown'}`;

        const channelMessage: ChannelMessage = {
          messageId: msg.name ?? msg.id ?? `reddit-${Date.now()}`,
          platform: 'reddit',
          conversationId,
          conversationType: isComment ? 'thread' : 'direct',
          sender: {
            id: msg.author ?? 'unknown',
            username: msg.author,
            displayName: msg.author,
          },
          content: [{ type: 'text', text: msg.body ?? '' }],
          text: msg.body ?? '',
          timestamp: new Date(createdAt).toISOString(),
          rawEvent: msg,
        };

        this.emit({
          type: 'message',
          platform: 'reddit',
          conversationId,
          timestamp: channelMessage.timestamp,
          data: channelMessage,
        });

        if (createdAt > this.lastInboxTimestamp) {
          this.lastInboxTimestamp = createdAt;
        }
      }
    } catch {
      // Non-fatal — will retry on next poll
    }
  }

  // ── Text helpers ──

  private extractText(blocks: MessageContentBlock[]): string {
    return blocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  /**
   * Extract the first line as a title. Reddit requires titles for posts.
   */
  private extractTitle(text: string): string {
    const firstLine = text.split('\n')[0]?.trim();
    if (firstLine && firstLine.length <= 300) return firstLine;
    if (firstLine) return firstLine.slice(0, 297) + '...';
    return 'Post from AgentOS';
  }

  /**
   * Extract everything after the first line as the body.
   */
  private extractBody(text: string): string {
    const lines = text.split('\n');
    if (lines.length <= 1) return '';
    return lines.slice(1).join('\n').trim();
  }
}
