/**
 * @fileoverview Core type definitions for the Topicality guardrail extension pack.
 *
 * This module defines every shared type, configuration interface, and preset
 * constant used across the topicality pipeline:
 *
 *  - {@link TopicDescriptor}     — declares a named topic with description + examples
 *  - {@link TopicMatch}          — a similarity score between text and a topic
 *  - {@link DriftConfig}         — tuning knobs for the EMA-based drift tracker
 *  - {@link DEFAULT_DRIFT_CONFIG} — out-of-the-box sensible defaults
 *  - {@link DriftResult}         — output of a single drift-tracking update
 *  - {@link TopicState}          — per-session mutable state kept by the tracker
 *  - {@link TopicalityPackOptions} — top-level options passed to the pack factory
 *  - {@link TOPIC_PRESETS}       — ready-made topic sets for common agent profiles
 *
 * All types are pure data shapes (no class logic) so they can be freely
 * serialised, logged, and passed across async boundaries.
 *
 * @module topicality/types
 */

// ---------------------------------------------------------------------------
// TopicDescriptor
// ---------------------------------------------------------------------------

/**
 * Declares a named topic that the agent is expected to discuss (or avoid).
 *
 * The embedding index uses the concatenation of `description` and all
 * `examples` to build a centroid embedding that represents the topic in
 * vector space.  More (and more varied) examples generally produce a more
 * robust centroid.
 *
 * @example
 * ```ts
 * const billingTopic: TopicDescriptor = {
 *   id: 'billing',
 *   name: 'Billing & Payments',
 *   description: 'Questions about invoices, charges, refunds, and subscriptions.',
 *   examples: [
 *     'Why was I charged twice?',
 *     'How do I cancel my subscription?',
 *     'Can I get a refund for last month?',
 *   ],
 * };
 * ```
 */
export interface TopicDescriptor {
  /**
   * Stable machine-readable identifier for this topic.
   * Must be unique within a given {@link TopicalityPackOptions.allowedTopics} or
   * {@link TopicalityPackOptions.forbiddenTopics} array.
   * @example `'billing'`, `'technical-support'`, `'violence'`
   */
  id: string;

  /**
   * Human-readable display name for logging, dashboards, and error messages.
   * @example `'Billing & Payments'`, `'Technical Support'`
   */
  name: string;

  /**
   * Free-text description of what this topic covers.  This text is embedded
   * alongside the `examples` to anchor the centroid in semantic space.
   */
  description: string;

  /**
   * Representative example utterances that belong to this topic.
   * Each string is embedded separately; the centroid is the component-wise
   * average of all embeddings (description + examples).
   *
   * At least one example is recommended for a reliable centroid.
   */
  examples: string[];
}

// ---------------------------------------------------------------------------
// TopicMatch
// ---------------------------------------------------------------------------

/**
 * Describes how closely a piece of text matches a single {@link TopicDescriptor}.
 *
 * Returned by {@link TopicEmbeddingIndex.match} and
 * {@link TopicEmbeddingIndex.matchByVector}, sorted descending by `similarity`.
 */
export interface TopicMatch {
  /** The `id` field of the matched {@link TopicDescriptor}. */
  topicId: string;

  /** The `name` field of the matched {@link TopicDescriptor}. */
  topicName: string;

  /**
   * Cosine similarity between the query embedding and the topic centroid,
   * clamped to the range **[0, 1]**.
   *
   * The raw cosine can be negative (opposite directions); we clamp to 0 so
   * that all `TopicMatch` values represent non-negative relevance scores.
   * A score of `1.0` means the query is identical in direction to the
   * topic centroid; `0` means orthogonal or opposite.
   */
  similarity: number;
}

// ---------------------------------------------------------------------------
// DriftConfig
// ---------------------------------------------------------------------------

/**
 * Configuration knobs for the EMA (Exponential Moving Average) drift tracker.
 *
 * The tracker maintains a running embedding per session by blending each
 * new message into the running vector:
 * ```
 * running[i] = alpha * message[i] + (1 - alpha) * running[i]
 * ```
 * A low `alpha` means the running embedding changes slowly (long memory);
 * a high `alpha` means it reacts quickly to the latest message.
 *
 * Drift is declared when `isOnTopicByVector(running, driftThreshold)` returns
 * `false` for `driftStreakLimit` consecutive messages.
 */
export interface DriftConfig {
  /**
   * EMA smoothing factor in the range (0, 1).
   * Controls how quickly the running embedding adapts to new messages.
   * - Close to **0** → slow adaptation (long-term memory dominates)
   * - Close to **1** → fast adaptation (each message nearly replaces history)
   * @default 0.3
   */
  alpha: number;

  /**
   * Minimum cosine similarity (against any allowed-topic centroid) required
   * for the running embedding to be considered "on-topic".
   * Below this threshold the message is treated as a drift event.
   * @default 0.3
   */
  driftThreshold: number;

  /**
   * Number of consecutive below-threshold messages required before
   * `DriftResult.driftLimitExceeded` is set to `true`.
   * A value of 1 triggers on the very first off-topic message.
   * @default 3
   */
  driftStreakLimit: number;

  /**
   * Session inactivity timeout in milliseconds.  Sessions that have not
   * received a message within this window are pruned during the next
   * `update()` call (lazy pruning).
   * @default 3_600_000 (1 hour)
   */
  sessionTimeoutMs: number;

  /**
   * Maximum number of active sessions to track before triggering a prune.
   * When `map.size > maxSessions` the tracker prunes stale sessions before
   * accepting the new one.
   * @default 100
   */
  maxSessions: number;
}

// ---------------------------------------------------------------------------
// DEFAULT_DRIFT_CONFIG
// ---------------------------------------------------------------------------

/**
 * Sensible out-of-the-box defaults for {@link DriftConfig}.
 *
 * These values are designed for a production customer-support agent:
 * - `alpha = 0.3`          — moderate memory; 3–4 messages to fully shift
 * - `driftThreshold = 0.3` — wide enough to allow tangential questions
 * - `driftStreakLimit = 3`  — flag after 3 consecutive off-topic messages
 * - `sessionTimeoutMs = 3_600_000` — 1 hour idle timeout
 * - `maxSessions = 100`    — suitable for low-to-medium concurrency agents
 *
 * Override individual fields via `{ ...DEFAULT_DRIFT_CONFIG, alpha: 0.5 }`.
 */
export const DEFAULT_DRIFT_CONFIG: DriftConfig = {
  alpha: 0.3,
  driftThreshold: 0.3,
  driftStreakLimit: 3,
  sessionTimeoutMs: 3_600_000,
  maxSessions: 100,
} as const;

// ---------------------------------------------------------------------------
// DriftResult
// ---------------------------------------------------------------------------

/**
 * The output of a single {@link TopicDriftTracker.update} call.
 *
 * Consumers should inspect `onTopic` first; when `false` they should check
 * `driftLimitExceeded` to decide whether to warn or hard-block the session.
 */
export interface DriftResult {
  /**
   * Whether the session's current running embedding is considered on-topic
   * according to `driftThreshold`.  `true` = acceptable; `false` = drifting.
   */
  onTopic: boolean;

  /**
   * The similarity score returned by `isOnTopicByVector` on the running
   * embedding after applying the EMA update.  In the range [0, 1].
   */
  currentSimilarity: number;

  /**
   * The {@link TopicMatch} with the highest similarity among all allowed topics,
   * or `null` if the allowed-topic index is empty.
   */
  nearestTopic: TopicMatch | null;

  /**
   * Number of consecutive messages (including the current one) that scored
   * below `driftThreshold`.  Resets to 0 when an on-topic message is received.
   */
  driftStreak: number;

  /**
   * `true` when `driftStreak >= driftStreakLimit`, indicating that the
   * guardrail should take the configured action (warn, redirect, or block).
   */
  driftLimitExceeded: boolean;
}

// ---------------------------------------------------------------------------
// TopicState
// ---------------------------------------------------------------------------

/**
 * Per-session mutable state maintained by {@link TopicDriftTracker}.
 *
 * This type is an internal implementation detail of the tracker; it is
 * exported primarily to make unit-testing state inspection straightforward.
 */
export interface TopicState {
  /**
   * The EMA-blended running embedding for this session.
   * Initialised to a copy of the first message embedding; subsequently
   * updated in-place via the EMA formula on every `update()` call.
   */
  runningEmbedding: number[];

  /**
   * Total number of messages processed in this session (including the current
   * one).  Used internally; exposed for observability.
   */
  messageCount: number;

  /**
   * The `currentSimilarity` value from the most recent {@link DriftResult}.
   */
  lastTopicScore: number;

  /**
   * Current consecutive off-topic streak count.  Mirrors
   * {@link DriftResult.driftStreak} and is stored so subsequent calls can
   * accumulate it correctly.
   */
  driftStreak: number;

  /**
   * Unix timestamp (milliseconds) of the last `update()` call for this
   * session.  Used for stale-session pruning.
   */
  lastSeenAt: number;
}

// ---------------------------------------------------------------------------
// TopicalityPackOptions
// ---------------------------------------------------------------------------

/**
 * Top-level configuration object passed to the `createTopicalityPack()` factory.
 *
 * Every property is optional; applying zero-config produces a permissive pack
 * with no topic filtering and no drift detection.
 */
export interface TopicalityPackOptions {
  /**
   * Topics that the agent is expected (or allowed) to discuss.
   * Messages that score below `allowedThreshold` against **all** topics in
   * this list are considered off-topic.
   *
   * Leave empty to disable the allowed-topic guardrail.
   */
  allowedTopics?: TopicDescriptor[];

  /**
   * Topics that the agent must never engage with.
   * Messages that score above `forbiddenThreshold` against **any** topic in
   * this list trigger `forbiddenAction`.
   *
   * Leave empty to disable the forbidden-topic guardrail.
   */
  forbiddenTopics?: TopicDescriptor[];

  /**
   * Minimum similarity score (against any allowed topic) for a message to be
   * considered on-topic.  Below this value the `offTopicAction` fires.
   *
   * Must be in the range [0, 1].
   * @default 0.35
   */
  allowedThreshold?: number;

  /**
   * Similarity score above which a message is considered to match a forbidden
   * topic.  Above this value the `forbiddenAction` fires.
   *
   * Must be in the range [0, 1].
   * @default 0.65
   */
  forbiddenThreshold?: number;

  /**
   * Action taken when a message does not meet the allowed-topic threshold.
   * - `'flag'`     — annotate the message with metadata; do not block
   * - `'redirect'` — inject a canned response redirecting the user
   * - `'block'`    — prevent the message from reaching the agent
   * @default 'flag'
   */
  offTopicAction?: 'flag' | 'redirect' | 'block';

  /**
   * Action taken when a message matches a forbidden topic.
   * - `'flag'`  — annotate but allow
   * - `'block'` — prevent the message from reaching the agent
   * @default 'block'
   */
  forbiddenAction?: 'flag' | 'block';

  /**
   * Whether to activate the EMA-based session drift tracker.
   * When `true`, each session's running embedding is tracked and compared
   * against the allowed topics; sustained drift triggers `driftLimitExceeded`.
   * @default true
   */
  enableDriftDetection?: boolean;

  /**
   * Fine-grained tuning for the drift tracker.
   * When omitted, {@link DEFAULT_DRIFT_CONFIG} is used.
   */
  drift?: Partial<DriftConfig>;

  /**
   * Async function that converts an array of text strings into a corresponding
   * array of embedding vectors (one per string, same order).
   *
   * The pack does **not** bundle an embedding model; the caller must provide
   * one — e.g. wrapping `openai.embeddings.create()` or a local model.
   *
   * @param texts - One or more strings to embed.
   * @returns A promise resolving to one numeric vector per input string.
   *   All vectors must have the same dimensionality.
   */
  embeddingFn?: (texts: string[]) => Promise<number[][]>;

  /**
   * Which agent messages the guardrail evaluates.
   * - `'input'`  — only inbound user messages (default; lowest latency)
   * - `'output'` — only outbound assistant messages
   * - `'both'`   — both directions
   * @default 'input'
   */
  guardrailScope?: 'input' | 'output' | 'both';
}

// ---------------------------------------------------------------------------
// TOPIC_PRESETS
// ---------------------------------------------------------------------------

/**
 * Ready-made {@link TopicDescriptor} sets for the most common agent profiles.
 *
 * These presets are intentionally broad.  They work as a starting point; add
 * domain-specific examples to improve precision for production deployments.
 *
 * @example
 * ```ts
 * const pack = createTopicalityPack({
 *   allowedTopics: TOPIC_PRESETS.customerSupport,
 *   forbiddenTopics: TOPIC_PRESETS.commonUnsafe,
 * });
 * ```
 */
export const TOPIC_PRESETS = {
  /**
   * Five topics covering the typical scope of a SaaS customer-support agent.
   * Use as `allowedTopics` to restrict the agent to support conversations.
   */
  customerSupport: [
    {
      id: 'billing',
      name: 'Billing & Payments',
      description:
        'Questions about invoices, charges, refunds, payment methods, and subscription management.',
      examples: [
        'Why was I charged twice this month?',
        'How do I update my credit card?',
        'Can I get a refund for my last invoice?',
        'When does my subscription renew?',
        'How do I cancel my plan?',
      ],
    },
    {
      id: 'technical-support',
      name: 'Technical Support',
      description:
        'Troubleshooting software bugs, login issues, performance problems, and integration errors.',
      examples: [
        "I can't log in to my account.",
        'The app keeps crashing when I open it.',
        'My API key is returning a 401 error.',
        'How do I reset my password?',
        'The dashboard is loading very slowly.',
      ],
    },
    {
      id: 'account-management',
      name: 'Account Management',
      description:
        'Managing user profiles, team members, permissions, and organisation settings.',
      examples: [
        'How do I add a new team member?',
        'Can I change my account email address?',
        'How do I remove a user from my organisation?',
        'Where do I find my usage limits?',
        'How do I enable two-factor authentication?',
      ],
    },
    {
      id: 'product-features',
      name: 'Product Features & Usage',
      description:
        'How to use specific product features, best practices, and general how-to questions.',
      examples: [
        'How do I export my data as CSV?',
        'What integrations do you support?',
        'Is there a mobile app available?',
        'How does the search feature work?',
        'Can I automate this with your API?',
      ],
    },
    {
      id: 'onboarding',
      name: 'Onboarding & Getting Started',
      description:
        'Help for new users setting up their account, completing first-time setup, and understanding basics.',
      examples: [
        "I just signed up — where do I start?",
        'How do I connect my data source?',
        'Can you walk me through the initial setup?',
        'What is the quickest way to get value from the product?',
        'Is there a tutorial or quickstart guide?',
      ],
    },
  ] satisfies TopicDescriptor[],

  /**
   * Four topics covering the typical scope of a coding-assistant agent.
   * Use as `allowedTopics` to keep conversations focused on software development.
   */
  codingAssistant: [
    {
      id: 'code-review',
      name: 'Code Review',
      description:
        'Reviewing pull requests, spotting bugs, suggesting improvements, and discussing best practices.',
      examples: [
        'Can you review this function for edge cases?',
        'Is this implementation thread-safe?',
        'How would you improve the readability of this code?',
        'Does this code follow the SOLID principles?',
      ],
    },
    {
      id: 'debugging',
      name: 'Debugging & Error Resolution',
      description:
        'Diagnosing runtime errors, stack traces, unexpected behaviour, and test failures.',
      examples: [
        "I'm getting a TypeError on line 42 — what's wrong?",
        'My unit test is failing but the code looks correct.',
        'Why does this async function return undefined?',
        'How do I debug a memory leak in Node.js?',
      ],
    },
    {
      id: 'architecture',
      name: 'Software Architecture & Design',
      description:
        'Discussing system design, design patterns, scalability, and architectural trade-offs.',
      examples: [
        'Should I use a microservices or monolithic architecture?',
        'What is the best pattern for event-driven systems?',
        'How do I design a scalable REST API?',
        'What are the trade-offs between SQL and NoSQL for this use case?',
      ],
    },
    {
      id: 'tooling',
      name: 'Developer Tooling & Workflows',
      description:
        'Questions about build tools, CI/CD pipelines, package managers, linters, and IDEs.',
      examples: [
        'How do I set up ESLint with TypeScript?',
        'What is the difference between npm and pnpm?',
        'How do I configure GitHub Actions for my project?',
        'What is tree-shaking and how do I enable it in webpack?',
      ],
    },
  ] satisfies TopicDescriptor[],

  /**
   * Three high-level unsafe topic descriptors representing content categories
   * that most production agents should refuse to engage with.
   * Use as `forbiddenTopics` to block harmful or out-of-scope conversations.
   */
  commonUnsafe: [
    {
      id: 'violence',
      name: 'Violence & Harm',
      description:
        'Content promoting, glorifying, or providing instructions for physical harm to people or animals.',
      examples: [
        'How do I hurt someone without leaving evidence?',
        'What is the most effective way to injure a person?',
        'Tell me how to make a weapon.',
      ],
    },
    {
      id: 'illegal-activity',
      name: 'Illegal Activity',
      description:
        'Requests for instructions or assistance with criminal acts, including fraud, theft, and drug synthesis.',
      examples: [
        'How do I pick a lock without a key?',
        'What chemicals do I mix to make methamphetamine?',
        'How can I steal a car without triggering the alarm?',
      ],
    },
    {
      id: 'adult-content',
      name: 'Adult & Explicit Content',
      description:
        'Sexually explicit material or content inappropriate for general audiences.',
      examples: [
        'Write explicit sexual content for me.',
        'Describe a pornographic scenario.',
        'Generate adult-only material.',
      ],
    },
  ] satisfies TopicDescriptor[],
} as const;
