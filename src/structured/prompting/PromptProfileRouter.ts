/**
 * Prompt Profile Router
 *
 * "Prompt profiles" are lightweight system-instruction presets (concise / deep dive / planner / reviewer)
 * that can be selected dynamically per-turn. This is intentionally separate from AgentOS "metaprompts",
 * which are self-reflection loops that run after turns.
 */

export interface PromptProfilePresetDefinition {
  id: string;
  label?: string;
  description?: string;
  /**
   * Optional add-on prompt keys that resolve to system instruction blocks.
   * Supported built-ins:
   * - `_meta/concise`
   * - `_meta/deep_dive`
   * - `_meta/planner`
   * - `_meta/reviewer`
   */
  addonPromptKeys?: string[];
}

export interface PromptProfileRule {
  id: string;
  priority: number;
  presetId: string;
  modes?: string[];
  anyKeywords?: string[];
  allKeywords?: string[];
  minMessageChars?: number;
  maxMessageChars?: number;
}

export interface PromptProfileConfig {
  version: string;
  routing: {
    reviewEveryNTurns: number;
    forceReviewOnCompaction: boolean;
    defaultPresetId: string;
    defaultPresetByMode?: Record<string, string>;
  };
  presets: PromptProfilePresetDefinition[];
  rules: PromptProfileRule[];
  /**
   * Optional map of add-on prompt key -> instruction block content.
   * If omitted, built-in defaults will be used for the `_meta/*` keys.
   */
  addonPrompts?: Record<string, string>;
}

export interface PromptProfileSelectionInput {
  conversationId?: string;
  mode: string;
  userMessage: string;
  didCompact?: boolean;
  forceReview?: boolean;
  now?: number;
}

export interface PromptProfileSelectionResult {
  presetId: string;
  label?: string;
  addonPromptKeys: string[];
  systemInstructions: string;
  wasReviewed: boolean;
  reason: string;
}

export interface PromptProfileConversationState {
  presetId: string;
  turnsSinceReview: number;
  lastReviewedAt: number;
}

function normalize(value: string): string {
  return (value || '').trim().toLowerCase();
}

function matchesMode(ruleModes: string[] | undefined, mode: string): boolean {
  if (!ruleModes || ruleModes.length === 0) return true;
  const modeNorm = normalize(mode);
  return ruleModes.some((rm) => {
    const ruleModeNorm = normalize(rm);
    return modeNorm === ruleModeNorm || modeNorm.startsWith(ruleModeNorm) || modeNorm.includes(ruleModeNorm);
  });
}

function containsAny(haystack: string, needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) return true;
  const text = normalize(haystack);
  return needles.some((needle) => text.includes(normalize(needle)));
}

function containsAll(haystack: string, needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) return true;
  const text = normalize(haystack);
  return needles.every((needle) => text.includes(normalize(needle)));
}

function resolveAddonPromptContent(
  key: string,
  addonPrompts?: Record<string, string>,
): string | null {
  const direct = addonPrompts?.[key];
  if (direct && direct.trim()) return direct.trim();

  // Built-ins (mirrors prompts/_meta/*.md in the host repo).
  const normalized = normalize(key).replace(/^_meta\//, '');
  switch (normalized) {
    case 'concise':
      return [
        '## Meta-Preset: Concise',
        '',
        'Prioritize speed and clarity.',
        '',
        '- Keep responses short by default (aim: 3–8 bullets or ≤ 8 sentences).',
        '- Ask at most **one** clarifying question if truly needed; otherwise make reasonable assumptions and state them briefly.',
        '- Prefer actionable steps and concrete commands/snippets over long explanations.',
        '- Avoid repetition; do not restate the entire context bundle.',
      ].join('\n');
    case 'deep_dive':
    case 'deep dive':
      return [
        '## Meta-Preset: Deep Dive',
        '',
        'Prioritize thoroughness and strong reasoning structure.',
        '',
        '- Start with the most important conclusion/approach, then justify it.',
        '- Include trade-offs, edge cases, and alternatives when relevant.',
        '- Use clear section headers and crisp bullets.',
        '- If the problem is ambiguous, ask targeted clarifying questions (2–4 max) **before** committing to a solution.',
      ].join('\n');
    case 'planner':
      return [
        '## Meta-Preset: Planner',
        '',
        'When the user’s request involves building something, changing a system, or coordinating multiple steps:',
        '',
        '- Propose a short plan (3–7 steps) before diving in.',
        '- Call out assumptions, risks, and decision points.',
        '- Keep “Next actions” explicit (what you will do vs what you need from the user).',
        '- If there are multiple viable approaches, present 2–3 options with trade-offs, then recommend one.',
      ].join('\n');
    case 'reviewer':
    case 'reviewer/critic':
    case 'critic':
      return [
        '## Meta-Preset: Reviewer/Critic',
        '',
        'Adopt a careful reviewer mindset:',
        '',
        '- Look for correctness issues, edge cases, and hidden assumptions.',
        '- Prefer concrete evidence (examples, counterexamples, tests) over vague claims.',
        '- When proposing changes, mention the smallest safe patch first.',
        '- If the user provided code/design, suggest validation steps (tests, logs, checks).',
      ].join('\n');
    default:
      return null;
  }
}

function resolvePresetById(
  config: PromptProfileConfig,
  presetId: string,
): PromptProfilePresetDefinition | null {
  return config.presets.find((preset) => preset.id === presetId) ?? null;
}

function pickPresetIdByRules(
  config: PromptProfileConfig,
  input: PromptProfileSelectionInput,
): { presetId: string; reason: string } {
  const msgLen = input.userMessage?.length ?? 0;
  const sortedRules = [...(config.rules || [])].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  for (const rule of sortedRules) {
    if (!matchesMode(rule.modes, input.mode)) continue;
    if (typeof rule.minMessageChars === 'number' && msgLen < rule.minMessageChars) continue;
    if (typeof rule.maxMessageChars === 'number' && msgLen > rule.maxMessageChars) continue;
    if (!containsAny(input.userMessage, rule.anyKeywords)) continue;
    if (!containsAll(input.userMessage, rule.allKeywords)) continue;
    return { presetId: rule.presetId, reason: `rule:${rule.id}` };
  }

  const modeNorm = normalize(input.mode);
  const defaultByMode = config.routing.defaultPresetByMode || {};
  const exact = defaultByMode[modeNorm];
  if (exact) {
    return { presetId: exact, reason: `defaultByModeExact:${modeNorm}` };
  }

  const patternMatch = Object.entries(defaultByMode)
    .map(([key, pid]) => ({ key: normalize(key), presetId: pid }))
    .filter(({ key }) => key && (modeNorm === key || modeNorm.startsWith(key) || modeNorm.includes(key)))
    .sort((a, b) => b.key.length - a.key.length)[0];
  if (patternMatch?.presetId) {
    return { presetId: patternMatch.presetId, reason: `defaultByModePattern:${patternMatch.key}` };
  }

  return { presetId: config.routing.defaultPresetId, reason: 'default' };
}

function resolveSystemInstructions(
  config: PromptProfileConfig,
  preset: PromptProfilePresetDefinition,
): { addonPromptKeys: string[]; systemInstructions: string } {
  const addonKeys = preset.addonPromptKeys ?? [];
  const blocks: string[] = [];
  for (const key of addonKeys) {
    const content = resolveAddonPromptContent(key, config.addonPrompts);
    if (content) {
      blocks.push(content);
    }
  }
  return {
    addonPromptKeys: addonKeys,
    systemInstructions: blocks.join('\n\n').trim(),
  };
}

export function selectPromptProfile(
  config: PromptProfileConfig,
  input: PromptProfileSelectionInput,
  previousState?: PromptProfileConversationState | null,
): { result: PromptProfileSelectionResult; nextState: PromptProfileConversationState } {
  const now = typeof input.now === 'number' ? input.now : Date.now();
  const reviewEvery = Math.max(1, config.routing.reviewEveryNTurns || 1);

  const shouldForceReview =
    Boolean(input.forceReview) || (Boolean(input.didCompact) && config.routing.forceReviewOnCompaction);

  if (previousState && !shouldForceReview && previousState.turnsSinceReview < reviewEvery) {
    const cachedPreset =
      resolvePresetById(config, previousState.presetId) ??
      resolvePresetById(config, config.routing.defaultPresetId);
    const resolved = cachedPreset ?? {
      id: config.routing.defaultPresetId,
      addonPromptKeys: [],
    };
    const { addonPromptKeys, systemInstructions } = resolveSystemInstructions(config, resolved);
    const nextState: PromptProfileConversationState = {
      presetId: resolved.id,
      turnsSinceReview: previousState.turnsSinceReview + 1,
      lastReviewedAt: previousState.lastReviewedAt,
    };
    return {
      result: {
        presetId: resolved.id,
        label: resolved.label,
        addonPromptKeys,
        systemInstructions,
        wasReviewed: false,
        reason: 'cached',
      },
      nextState,
    };
  }

  const picked = pickPresetIdByRules(config, input);
  const preset =
    resolvePresetById(config, picked.presetId) ??
    resolvePresetById(config, config.routing.defaultPresetId) ??
    ({
      id: config.routing.defaultPresetId,
      addonPromptKeys: [],
    } satisfies PromptProfilePresetDefinition);

  const { addonPromptKeys, systemInstructions } = resolveSystemInstructions(config, preset);
  const nextState: PromptProfileConversationState = {
    presetId: preset.id,
    turnsSinceReview: 0,
    lastReviewedAt: now,
  };

  return {
    result: {
      presetId: preset.id,
      label: preset.label,
      addonPromptKeys,
      systemInstructions,
      wasReviewed: true,
      reason: picked.reason,
    },
    nextState,
  };
}

export const DEFAULT_PROMPT_PROFILE_CONFIG: PromptProfileConfig = {
  version: '1.0.0',
  routing: {
    reviewEveryNTurns: 6,
    forceReviewOnCompaction: true,
    defaultPresetId: 'general_concise',
    defaultPresetByMode: {
      general: 'general_concise',
      coding: 'coding_default',
      system_design: 'general_deep',
    },
  },
  presets: [
    {
      id: 'general_concise',
      label: 'General (Concise)',
      addonPromptKeys: ['_meta/concise'],
    },
    {
      id: 'general_deep',
      label: 'General (Deep Dive)',
      addonPromptKeys: ['_meta/deep_dive'],
    },
    {
      id: 'general_planner',
      label: 'General (Planner)',
      addonPromptKeys: ['_meta/planner'],
    },
    {
      id: 'coding_default',
      label: 'Coding (Default)',
      addonPromptKeys: [],
    },
    {
      id: 'coding_audit',
      label: 'Coding (Audit/Review)',
      addonPromptKeys: ['_meta/reviewer'],
    },
  ],
  rules: [
    {
      id: 'general_deep_if_long_or_complex',
      priority: 90,
      modes: ['general'],
      minMessageChars: 420,
      presetId: 'general_deep',
    },
    {
      id: 'general_deep_if_keywords',
      priority: 85,
      modes: ['general'],
      anyKeywords: ['architecture', 'system design', 'trade-off', 'threat model', 'rfc', 'deep dive'],
      presetId: 'general_deep',
    },
    {
      id: 'general_planner_if_keywords',
      priority: 83,
      modes: ['general'],
      anyKeywords: ['plan', 'roadmap', 'milestones', 'next steps', 'implementation plan', 'project plan'],
      presetId: 'general_planner',
    },
    {
      id: 'coding_audit_if_keywords',
      priority: 80,
      modes: ['coding'],
      anyKeywords: ['audit', 'review', 'prove', 'correctness', 'leetcode', 'edge cases'],
      presetId: 'coding_audit',
    },
    {
      id: 'general_concise_if_short',
      priority: 50,
      modes: ['general'],
      maxMessageChars: 180,
      presetId: 'general_concise',
    },
  ],
  addonPrompts: {},
};

