/**
 * @fileoverview WhatsApp Channel Adapter for AgentOS.
 *
 * Supports two connection modes:
 *
 * 1. **Twilio WhatsApp API** — Uses the `twilio` npm package. Messages are
 *    sent via the Twilio REST API and inbound messages arrive via webhooks.
 * 2. **WhatsApp Business API (Cloud API)** — Uses direct HTTP calls to the
 *    Meta Graph API. No third-party SDK required.
 *
 * In both modes, the adapter requires a webhook endpoint to be configured
 * externally (e.g., an Express/Fastify route) that forwards incoming HTTP
 * requests to {@link handleIncomingWebhook}.
 *
 * **Dependencies**: For Twilio mode, requires the `twilio` package. For
 * Cloud API mode, no external dependencies are needed (uses native fetch).
 *
 * @example
 * ```typescript
 * // Twilio mode
 * const wa = new WhatsAppChannelAdapter();
 * await wa.initialize({
 *   platform: 'whatsapp',
 *   credential: 'TWILIO_AUTH_TOKEN',
 *   params: {
 *     provider: 'twilio',
 *     accountSid: 'ACXXXXXXX',
 *     authToken: 'TWILIO_AUTH_TOKEN',
 *     phoneNumber: '+14155238886',
 *   },
 * });
 *
 * // Cloud API mode
 * await wa.initialize({
 *   platform: 'whatsapp',
 *   credential: 'WHATSAPP_BUSINESS_TOKEN',
 *   params: {
 *     provider: 'cloud-api',
 *     businessApiToken: 'WHATSAPP_BUSINESS_TOKEN',
 *     phoneNumberId: '1234567890',
 *     verifyToken: 'MY_VERIFY_TOKEN',
 *   },
 * });
 * ```
 *
 * @module @framers/agentos/channels/adapters/WhatsAppChannelAdapter
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
// WhatsApp Auth Params
// ============================================================================

/** Platform-specific parameters for WhatsApp connections. */
export interface WhatsAppAuthParams extends Record<string, string | undefined> {
  /** Provider backend: 'twilio' or 'cloud-api'. Defaults to 'twilio'. */
  provider?: string;

  // Twilio-specific
  /** Twilio Account SID. */
  accountSid?: string;
  /** Twilio Auth Token. If provided, overrides credential. */
  authToken?: string;
  /** Twilio WhatsApp-enabled phone number (e.g., 'whatsapp:+14155238886'). */
  phoneNumber?: string;

  // Cloud API (Meta) specific
  /** WhatsApp Business API access token. If provided, overrides credential. */
  businessApiToken?: string;
  /** Phone Number ID from the WhatsApp Business Platform. */
  phoneNumberId?: string;
  /** Graph API version (default: 'v21.0'). */
  apiVersion?: string;
  /** Verify token for webhook validation. */
  verifyToken?: string;
}

// ============================================================================
// WhatsAppChannelAdapter
// ============================================================================

/**
 * Channel adapter for WhatsApp supporting both Twilio and Meta Cloud API.
 *
 * This adapter does NOT start its own HTTP server. Instead, the host
 * application must configure a webhook route and call
 * {@link handleIncomingWebhook} with the raw request body.
 *
 * Capabilities: text, images, video, audio, voice_notes, documents,
 * reactions, buttons, group_chat.
 */
export class WhatsAppChannelAdapter extends BaseChannelAdapter<WhatsAppAuthParams> {
  readonly platform: ChannelPlatform = 'whatsapp';
  readonly displayName = 'WhatsApp';
  readonly capabilities: readonly ChannelCapability[] = [
    'text',
    'images',
    'video',
    'audio',
    'voice_notes',
    'documents',
    'reactions',
    'buttons',
    'group_chat',
  ] as const;

  /** Twilio client instance (when using Twilio provider). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private twilioClient: any | undefined;

  /** Provider mode. */
  private provider: 'twilio' | 'cloud-api' = 'twilio';

  /** Stored credentials for API calls. */
  private phoneNumber: string | undefined;
  private phoneNumberId: string | undefined;
  private businessApiToken: string | undefined;
  private graphApiVersion = 'v21.0';
  private verifyToken: string | undefined;

  // ── Abstract hook implementations ──

  protected async doConnect(
    auth: ChannelAuthConfig & { params?: WhatsAppAuthParams },
  ): Promise<void> {
    const params = auth.params ?? ({} as WhatsAppAuthParams);
    this.provider = (params.provider as 'twilio' | 'cloud-api') ?? 'twilio';

    if (this.provider === 'twilio') {
      await this.connectTwilio(auth, params);
    } else {
      await this.connectCloudApi(auth, params);
    }
  }

  protected async doSendMessage(
    conversationId: string,
    content: MessageContent,
  ): Promise<ChannelSendResult> {
    if (this.provider === 'twilio') {
      return this.sendViaTwilio(conversationId, content);
    }
    return this.sendViaCloudApi(conversationId, content);
  }

  protected async doShutdown(): Promise<void> {
    this.twilioClient = undefined;
    this.businessApiToken = undefined;
    this.phoneNumber = undefined;
    this.phoneNumberId = undefined;
    console.log('[WhatsApp] Adapter shut down.');
  }

  // ── IChannelAdapter optional methods ──

  async addReaction(
    conversationId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    if (this.provider !== 'cloud-api' || !this.businessApiToken || !this.phoneNumberId) {
      console.warn('[WhatsApp] Reactions are only supported via the Cloud API.');
      return;
    }

    const url = `https://graph.facebook.com/${this.graphApiVersion}/${this.phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to: conversationId,
      type: 'reaction',
      reaction: {
        message_id: messageId,
        emoji,
      },
    };

    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.businessApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  // ── Public: Webhook handler ──

  /**
   * Handle an incoming webhook request from WhatsApp (Twilio or Cloud API).
   *
   * The host application should forward the raw request body to this method.
   * For Cloud API, this also handles webhook verification (GET requests
   * with `hub.mode=subscribe`).
   *
   * @param body - Parsed JSON body of the webhook request.
   * @param queryParams - Query parameters (for Cloud API verification).
   * @returns Verification challenge string for GET requests, or void.
   */
  handleIncomingWebhook(
    body: Record<string, unknown>,
    queryParams?: Record<string, string>,
  ): string | void {
    // Cloud API webhook verification (GET request)
    if (
      queryParams?.['hub.mode'] === 'subscribe' &&
      queryParams?.['hub.verify_token']
    ) {
      if (queryParams['hub.verify_token'] === this.verifyToken) {
        return queryParams['hub.challenge'] ?? '';
      }
      console.warn('[WhatsApp] Webhook verification failed — token mismatch.');
      return;
    }

    if (this.provider === 'twilio') {
      this.handleTwilioWebhook(body);
    } else {
      this.handleCloudApiWebhook(body);
    }
  }

  // ── Private: Twilio ──

  private async connectTwilio(
    auth: ChannelAuthConfig,
    params: WhatsAppAuthParams,
  ): Promise<void> {
    const accountSid = params.accountSid;
    const authToken = params.authToken ?? auth.credential;
    this.phoneNumber = params.phoneNumber;

    if (!accountSid) {
      throw new Error('Twilio accountSid is required for WhatsApp (Twilio mode).');
    }
    if (!authToken) {
      throw new Error('Twilio authToken is required for WhatsApp (Twilio mode).');
    }
    if (!this.phoneNumber) {
      throw new Error('WhatsApp phone number is required for Twilio mode.');
    }

    // Ensure phone number has whatsapp: prefix
    if (!this.phoneNumber.startsWith('whatsapp:')) {
      this.phoneNumber = `whatsapp:${this.phoneNumber}`;
    }

    // Dynamic import
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let TwilioModule: any;
    try {
      TwilioModule = await import('twilio');
    } catch {
      throw new Error(
        'The "twilio" package is required for WhatsApp (Twilio mode). ' +
          'Install it with: npm install twilio',
      );
    }

    const TwilioClient = TwilioModule.default ?? TwilioModule.Twilio ?? TwilioModule;
    this.twilioClient = new TwilioClient(accountSid, authToken);

    // Verify credentials by fetching account info
    try {
      const account = await this.twilioClient.api.accounts(accountSid).fetch();
      this.platformInfo = {
        provider: 'twilio',
        accountSid,
        phoneNumber: this.phoneNumber,
        accountName: account.friendlyName,
      };
      console.log(
        `[WhatsApp] Connected via Twilio (${account.friendlyName}, ${this.phoneNumber})`,
      );
    } catch (err) {
      // Credentials might still be valid for messaging even if account fetch fails
      this.platformInfo = {
        provider: 'twilio',
        accountSid,
        phoneNumber: this.phoneNumber,
      };
      console.log(`[WhatsApp] Connected via Twilio (${this.phoneNumber})`);
    }
  }

  private async sendViaTwilio(
    conversationId: string,
    content: MessageContent,
  ): Promise<ChannelSendResult> {
    if (!this.twilioClient || !this.phoneNumber) {
      throw new Error('[WhatsApp] Twilio client is not connected.');
    }

    // Ensure destination has whatsapp: prefix
    const to = conversationId.startsWith('whatsapp:')
      ? conversationId
      : `whatsapp:${conversationId}`;

    let lastSid = '';
    let lastTimestamp = '';

    for (const block of content.blocks) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msgPayload: any = {
        from: this.phoneNumber,
        to,
      };

      switch (block.type) {
        case 'text':
          msgPayload.body = block.text;
          break;
        case 'image':
          msgPayload.mediaUrl = [block.url];
          msgPayload.body = block.caption ?? '';
          break;
        case 'video':
          msgPayload.mediaUrl = [block.url];
          msgPayload.body = block.caption ?? '';
          break;
        case 'audio':
          msgPayload.mediaUrl = [block.url];
          break;
        case 'document':
          msgPayload.mediaUrl = [block.url];
          msgPayload.body = block.filename;
          break;
        case 'location':
          // Twilio doesn't support native location — send as text
          msgPayload.body = `Location: ${block.latitude}, ${block.longitude}${block.name ? ` (${block.name})` : ''}`;
          break;
        case 'button_group':
          // Twilio interactive messages — fall back to text
          msgPayload.body = block.buttons
            .map((btn, i) => `${i + 1}. ${btn.label}`)
            .join('\n');
          break;
        default:
          continue;
      }

      if (!msgPayload.body && !msgPayload.mediaUrl) continue;

      const result = await this.twilioClient.messages.create(msgPayload);
      lastSid = result.sid ?? '';
      lastTimestamp = result.dateCreated?.toISOString() ?? new Date().toISOString();
    }

    if (!lastSid) {
      throw new Error('[WhatsApp] No content blocks produced a sent message.');
    }

    return {
      messageId: lastSid,
      timestamp: lastTimestamp,
    };
  }

  private handleTwilioWebhook(body: Record<string, unknown>): void {
    // Twilio sends form-encoded data; by the time it reaches us it should be parsed
    const from = String(body.From ?? '').replace('whatsapp:', '');
    const to = String(body.To ?? '').replace('whatsapp:', '');
    const messageBody = String(body.Body ?? '');
    const messageSid = String(body.MessageSid ?? '');
    const numMedia = parseInt(String(body.NumMedia ?? '0'), 10);

    if (!from || !messageSid) return;

    const contentBlocks: MessageContentBlock[] = [];

    // Text
    if (messageBody) {
      contentBlocks.push({ type: 'text', text: messageBody });
    }

    // Media attachments
    for (let i = 0; i < numMedia; i++) {
      const mediaUrl = String(body[`MediaUrl${i}`] ?? '');
      const mediaType = String(body[`MediaContentType${i}`] ?? '');

      if (!mediaUrl) continue;

      if (mediaType.startsWith('image/')) {
        contentBlocks.push({ type: 'image', url: mediaUrl, mimeType: mediaType });
      } else if (mediaType.startsWith('video/')) {
        contentBlocks.push({ type: 'video', url: mediaUrl, mimeType: mediaType });
      } else if (mediaType.startsWith('audio/')) {
        contentBlocks.push({ type: 'audio', url: mediaUrl, mimeType: mediaType });
      } else {
        contentBlocks.push({
          type: 'document',
          url: mediaUrl,
          filename: `attachment_${i}`,
          mimeType: mediaType,
        });
      }
    }

    if (contentBlocks.length === 0) {
      contentBlocks.push({ type: 'text', text: '' });
    }

    const channelMessage: ChannelMessage = {
      messageId: messageSid,
      platform: 'whatsapp',
      conversationId: from,
      conversationType: 'direct',
      sender: {
        id: from,
        displayName: String(body.ProfileName ?? undefined),
      },
      content: contentBlocks,
      text: messageBody,
      timestamp: new Date().toISOString(),
      rawEvent: body,
    };

    this.emit({
      type: 'message',
      platform: 'whatsapp',
      conversationId: from,
      timestamp: channelMessage.timestamp,
      data: channelMessage,
    });
  }

  // ── Private: Cloud API (Meta) ──

  private async connectCloudApi(
    auth: ChannelAuthConfig,
    params: WhatsAppAuthParams,
  ): Promise<void> {
    this.businessApiToken = params.businessApiToken ?? auth.credential;
    this.phoneNumberId = params.phoneNumberId;
    this.graphApiVersion = params.apiVersion ?? 'v21.0';
    this.verifyToken = params.verifyToken;

    if (!this.businessApiToken) {
      throw new Error(
        'WhatsApp Business API token is required. Provide it as credential or params.businessApiToken.',
      );
    }
    if (!this.phoneNumberId) {
      throw new Error('phoneNumberId is required for WhatsApp Cloud API mode.');
    }

    // Verify token by fetching phone number info
    try {
      const url = `https://graph.facebook.com/${this.graphApiVersion}/${this.phoneNumberId}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${this.businessApiToken}` },
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      }

      const data = await resp.json() as Record<string, unknown>;
      this.platformInfo = {
        provider: 'cloud-api',
        phoneNumberId: this.phoneNumberId,
        displayPhoneNumber: data.display_phone_number,
        verifiedName: data.verified_name,
        apiVersion: this.graphApiVersion,
      };
      console.log(
        `[WhatsApp] Connected via Cloud API (${data.verified_name ?? this.phoneNumberId})`,
      );
    } catch (err) {
      // Still allow connection — the token might work for sending even if GET fails
      this.platformInfo = {
        provider: 'cloud-api',
        phoneNumberId: this.phoneNumberId,
        apiVersion: this.graphApiVersion,
      };
      console.warn(`[WhatsApp] Cloud API credential verification failed: ${err}`);
      console.log(`[WhatsApp] Connected via Cloud API (${this.phoneNumberId})`);
    }
  }

  private async sendViaCloudApi(
    conversationId: string,
    content: MessageContent,
  ): Promise<ChannelSendResult> {
    if (!this.businessApiToken || !this.phoneNumberId) {
      throw new Error('[WhatsApp] Cloud API credentials not configured.');
    }

    const url = `https://graph.facebook.com/${this.graphApiVersion}/${this.phoneNumberId}/messages`;
    let lastMessageId = '';
    let lastTimestamp = '';

    for (const block of content.blocks) {
      const payload = this.buildCloudApiPayload(conversationId, block, content);
      if (!payload) continue;

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.businessApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        throw new Error(`[WhatsApp] Cloud API error ${resp.status}: ${errorText}`);
      }

      const result = await resp.json() as Record<string, unknown>;
      const messages = result.messages as Array<{ id: string }> | undefined;
      if (messages?.[0]?.id) {
        lastMessageId = messages[0].id;
        lastTimestamp = new Date().toISOString();
      }
    }

    if (!lastMessageId) {
      throw new Error('[WhatsApp] No content blocks produced a sent message.');
    }

    return {
      messageId: lastMessageId,
      timestamp: lastTimestamp,
    };
  }

  /**
   * Build a Cloud API message payload for a single content block.
   */
  private buildCloudApiPayload(
    to: string,
    block: MessageContentBlock,
    content: MessageContent,
  ): Record<string, unknown> | undefined {
    const base = {
      messaging_product: 'whatsapp',
      to,
      ...(content.replyToMessageId
        ? { context: { message_id: content.replyToMessageId } }
        : {}),
    };

    switch (block.type) {
      case 'text':
        return { ...base, type: 'text', text: { body: block.text } };

      case 'image':
        return {
          ...base,
          type: 'image',
          image: {
            link: block.url,
            caption: block.caption,
          },
        };

      case 'video':
        return {
          ...base,
          type: 'video',
          video: {
            link: block.url,
            caption: block.caption,
          },
        };

      case 'audio':
        return {
          ...base,
          type: 'audio',
          audio: { link: block.url },
        };

      case 'document':
        return {
          ...base,
          type: 'document',
          document: {
            link: block.url,
            filename: block.filename,
          },
        };

      case 'location':
        return {
          ...base,
          type: 'location',
          location: {
            latitude: block.latitude,
            longitude: block.longitude,
            name: block.name,
          },
        };

      case 'sticker':
        return {
          ...base,
          type: 'sticker',
          sticker: { id: block.stickerId },
        };

      case 'button_group': {
        // WhatsApp interactive message with buttons
        const textBlock = content.blocks.find((b) => b.type === 'text');
        const bodyText =
          textBlock && textBlock.type === 'text'
            ? textBlock.text
            : 'Choose an option:';

        return {
          ...base,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: bodyText },
            action: {
              buttons: block.buttons.slice(0, 3).map((btn) => ({
                type: 'reply',
                reply: {
                  id: btn.id,
                  title: btn.label.slice(0, 20), // WhatsApp limits to 20 chars
                },
              })),
            },
          },
        };
      }

      default:
        return undefined;
    }
  }

  private handleCloudApiWebhook(body: Record<string, unknown>): void {
    // Cloud API webhook structure:
    // { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [...] } }] }] }
    const entries = (body.entry ?? []) as Array<Record<string, unknown>>;

    for (const entry of entries) {
      const changes = (entry.changes ?? []) as Array<Record<string, unknown>>;

      for (const change of changes) {
        const value = change.value as Record<string, unknown> | undefined;
        if (!value) continue;

        const messages = (value.messages ?? []) as Array<Record<string, unknown>>;
        const contacts = (value.contacts ?? []) as Array<Record<string, unknown>>;

        for (const msg of messages) {
          const from = String(msg.from ?? '');
          const msgId = String(msg.id ?? '');
          const msgType = String(msg.type ?? 'text');
          const timestamp = msg.timestamp
            ? new Date(parseInt(String(msg.timestamp), 10) * 1000).toISOString()
            : new Date().toISOString();

          // Find contact info
          const contact = contacts.find(
            (c) => (c.wa_id as string) === from,
          );
          const profileName = contact
            ? (contact.profile as Record<string, unknown>)?.name
            : undefined;

          const contentBlocks: MessageContentBlock[] = [];

          switch (msgType) {
            case 'text': {
              const textData = msg.text as Record<string, unknown>;
              contentBlocks.push({ type: 'text', text: String(textData?.body ?? '') });
              break;
            }
            case 'image': {
              const imgData = msg.image as Record<string, unknown>;
              contentBlocks.push({
                type: 'image',
                url: String(imgData?.id ?? ''),
                caption: imgData?.caption ? String(imgData.caption) : undefined,
                mimeType: imgData?.mime_type ? String(imgData.mime_type) : undefined,
              });
              break;
            }
            case 'video': {
              const vidData = msg.video as Record<string, unknown>;
              contentBlocks.push({
                type: 'video',
                url: String(vidData?.id ?? ''),
                caption: vidData?.caption ? String(vidData.caption) : undefined,
                mimeType: vidData?.mime_type ? String(vidData.mime_type) : undefined,
              });
              break;
            }
            case 'audio': {
              const audioData = msg.audio as Record<string, unknown>;
              contentBlocks.push({
                type: 'audio',
                url: String(audioData?.id ?? ''),
                mimeType: audioData?.mime_type ? String(audioData.mime_type) : undefined,
              });
              break;
            }
            case 'document': {
              const docData = msg.document as Record<string, unknown>;
              contentBlocks.push({
                type: 'document',
                url: String(docData?.id ?? ''),
                filename: String(docData?.filename ?? 'document'),
                mimeType: docData?.mime_type ? String(docData.mime_type) : undefined,
              });
              break;
            }
            case 'sticker': {
              const stickerData = msg.sticker as Record<string, unknown>;
              contentBlocks.push({
                type: 'sticker',
                stickerId: String(stickerData?.id ?? ''),
              });
              break;
            }
            case 'location': {
              const locData = msg.location as Record<string, unknown>;
              contentBlocks.push({
                type: 'location',
                latitude: Number(locData?.latitude ?? 0),
                longitude: Number(locData?.longitude ?? 0),
                name: locData?.name ? String(locData.name) : undefined,
              });
              break;
            }
            default:
              contentBlocks.push({ type: 'text', text: `[Unsupported message type: ${msgType}]` });
              break;
          }

          if (contentBlocks.length === 0) {
            contentBlocks.push({ type: 'text', text: '' });
          }

          // Extract text for convenience field
          const text = contentBlocks
            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
            .map((b) => b.text)
            .join('\n');

          const channelMessage: ChannelMessage = {
            messageId: msgId,
            platform: 'whatsapp',
            conversationId: from,
            conversationType: 'direct',
            sender: {
              id: from,
              displayName: profileName ? String(profileName) : undefined,
            },
            content: contentBlocks,
            text,
            timestamp,
            replyToMessageId: msg.context
              ? String((msg.context as Record<string, unknown>).id ?? '')
              : undefined,
            rawEvent: msg,
          };

          this.emit({
            type: 'message',
            platform: 'whatsapp',
            conversationId: from,
            timestamp: channelMessage.timestamp,
            data: channelMessage,
          });
        }

        // Handle status updates (delivered, read, etc.) — emit as connection events
        const statuses = (value.statuses ?? []) as Array<Record<string, unknown>>;
        for (const status of statuses) {
          if (status.status === 'read') {
            // Could be used for read receipts in the future
          }
        }
      }
    }
  }
}
