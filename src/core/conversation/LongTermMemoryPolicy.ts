export type LongTermMemoryScope = 'conversation' | 'user' | 'persona' | 'organization';

export type RollingSummaryMemoryCategory =
  | 'facts'
  | 'preferences'
  | 'people'
  | 'projects'
  | 'decisions'
  | 'open_loops'
  | 'todo'
  | 'tags';

export const LONG_TERM_MEMORY_POLICY_METADATA_KEY = 'longTermMemoryPolicy';
export const ORGANIZATION_ID_METADATA_KEY = 'organizationId';

export interface LongTermMemoryPolicyInput {
  /**
   * Master switch for persisting long-term memory (e.g., to RAG / knowledge graph).
   *
   * Notes:
   * - This does NOT disable rolling-summary compaction (prompt compaction).
   * - When false, sinks should not persist any long-term memory artifacts.
   */
  enabled?: boolean;
  /**
   * Enabled scopes for persistence. Unspecified scopes inherit prior/default values.
   *
   * Defaults are conservative:
   * - conversation: true
   * - user/persona/org: false
   */
  scopes?: Partial<Record<LongTermMemoryScope, boolean>>;
  /**
   * Explicit opt-in required to write to organization-scoped memory.
   * Even when `scopes.organization=true`, implementations should gate on this flag.
   */
  shareWithOrganization?: boolean;
  /** Whether to create atomic per-item memory docs from `memory_json` (recommended). */
  storeAtomicDocs?: boolean;
  /**
   * Optional allowlist of `memory_json` categories to persist as atomic docs.
   * - `null` / `undefined`: persist all categories supported by the sink
   * - `[]`: persist none
   */
  allowedCategories?: RollingSummaryMemoryCategory[];
}

export interface AgentOSMemoryControl {
  longTermMemory?: LongTermMemoryPolicyInput;
}

export interface ResolvedLongTermMemoryPolicy {
  enabled: boolean;
  scopes: Record<LongTermMemoryScope, boolean>;
  shareWithOrganization: boolean;
  storeAtomicDocs: boolean;
  allowedCategories: RollingSummaryMemoryCategory[] | null;
}

export const DEFAULT_LONG_TERM_MEMORY_POLICY: ResolvedLongTermMemoryPolicy = {
  enabled: true,
  scopes: {
    conversation: true,
    user: false,
    persona: false,
    organization: false,
  },
  shareWithOrganization: false,
  storeAtomicDocs: true,
  allowedCategories: null,
};

const KNOWN_CATEGORIES = new Set<RollingSummaryMemoryCategory>([
  'facts',
  'preferences',
  'people',
  'projects',
  'decisions',
  'open_loops',
  'todo',
  'tags',
]);

function normalizeCategory(value: unknown): RollingSummaryMemoryCategory | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return KNOWN_CATEGORIES.has(trimmed as RollingSummaryMemoryCategory)
    ? (trimmed as RollingSummaryMemoryCategory)
    : null;
}

export function resolveLongTermMemoryPolicy(args: {
  previous?: ResolvedLongTermMemoryPolicy | null;
  input?: LongTermMemoryPolicyInput | null;
  defaults?: ResolvedLongTermMemoryPolicy;
}): ResolvedLongTermMemoryPolicy {
  const base = args.defaults ?? DEFAULT_LONG_TERM_MEMORY_POLICY;
  const previous = args.previous ?? null;
  const input = args.input ?? null;

  const resolved: ResolvedLongTermMemoryPolicy = {
    enabled: previous?.enabled ?? base.enabled,
    scopes: {
      conversation: previous?.scopes?.conversation ?? base.scopes.conversation,
      user: previous?.scopes?.user ?? base.scopes.user,
      persona: previous?.scopes?.persona ?? base.scopes.persona,
      organization: previous?.scopes?.organization ?? base.scopes.organization,
    },
    shareWithOrganization: previous?.shareWithOrganization ?? base.shareWithOrganization,
    storeAtomicDocs: previous?.storeAtomicDocs ?? base.storeAtomicDocs,
    allowedCategories: previous?.allowedCategories ?? base.allowedCategories,
  };

  if (input) {
    if (typeof input.enabled === 'boolean') resolved.enabled = input.enabled;
    if (input.scopes && typeof input.scopes === 'object') {
      for (const [key, value] of Object.entries(input.scopes)) {
        if (key === 'conversation' || key === 'user' || key === 'persona' || key === 'organization') {
          if (typeof value === 'boolean') {
            resolved.scopes[key] = value;
          }
        }
      }
    }
    if (typeof input.shareWithOrganization === 'boolean') {
      resolved.shareWithOrganization = input.shareWithOrganization;
    }
    if (typeof input.storeAtomicDocs === 'boolean') {
      resolved.storeAtomicDocs = input.storeAtomicDocs;
    }
    if (Array.isArray(input.allowedCategories)) {
      const normalized = Array.from(
        new Set(
          input.allowedCategories
            .map((c) => normalizeCategory(c))
            .filter((c): c is RollingSummaryMemoryCategory => Boolean(c)),
        ),
      );
      resolved.allowedCategories = normalized;
    }
  }

  return resolved;
}

export function hasAnyLongTermMemoryScope(policy: ResolvedLongTermMemoryPolicy): boolean {
  return Boolean(
    policy?.scopes?.conversation ||
    policy?.scopes?.user ||
    policy?.scopes?.persona ||
    policy?.scopes?.organization,
  );
}

