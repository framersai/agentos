export type LongTermMemoryScope = 'conversation' | 'user' | 'persona' | 'organization';
export type RollingSummaryMemoryCategory = 'facts' | 'preferences' | 'people' | 'projects' | 'decisions' | 'open_loops' | 'todo' | 'tags';
export declare const LONG_TERM_MEMORY_POLICY_METADATA_KEY = "longTermMemoryPolicy";
export declare const ORGANIZATION_ID_METADATA_KEY = "organizationId";
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
export declare const DEFAULT_LONG_TERM_MEMORY_POLICY: ResolvedLongTermMemoryPolicy;
export declare function resolveLongTermMemoryPolicy(args: {
    previous?: ResolvedLongTermMemoryPolicy | null;
    input?: LongTermMemoryPolicyInput | null;
    defaults?: ResolvedLongTermMemoryPolicy;
}): ResolvedLongTermMemoryPolicy;
export declare function hasAnyLongTermMemoryScope(policy: ResolvedLongTermMemoryPolicy): boolean;
//# sourceMappingURL=LongTermMemoryPolicy.d.ts.map