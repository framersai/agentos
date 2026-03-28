/**
 * @file types.ts
 * @description All interfaces, enums, and types for the AgentOS Provenance system.
 * Covers storage policy, provenance config, autonomy config, signed events,
 * revisions, tombstones, anchors, and verification.
 *
 * @module AgentOS/Provenance
 */

// =============================================================================
// Storage Policy
// =============================================================================

export type StoragePolicyMode = 'mutable' | 'revisioned' | 'sealed';

export interface StoragePolicyConfig {
  /** Which mode to enforce. */
  mode: StoragePolicyMode;
  /** Tables subject to policy enforcement. Empty array or undefined = all tables. */
  protectedTables?: string[];
  /** Tables exempt from enforcement (e.g., cache, temp tables). */
  exemptTables?: string[];
}

// =============================================================================
// Provenance Config
// =============================================================================

export interface ProvenanceConfig {
  /** Whether the signed event ledger is active. */
  enabled: boolean;
  /** Sign every event individually, or only sign at anchor points. */
  signatureMode: 'every-event' | 'anchor-only';
  /** Hash algorithm for the chain. */
  hashAlgorithm: 'sha256' | 'sha384' | 'sha512';
  /** Agent keypair source. */
  keySource: AgentKeySource;
  /** Optional external anchor target configuration. */
  anchorTarget?: AnchorTarget;
}

export interface AgentKeySource {
  /** 'generate' creates a new keypair; 'import' uses provided keys. */
  type: 'generate' | 'import';
  /** For 'import': base64-encoded Ed25519 private key. */
  privateKeyBase64?: string;
  /** For 'import': base64-encoded Ed25519 public key. */
  publicKeyBase64?: string;
  /** Optional filesystem path for persisting generated keys. */
  keyStorePath?: string;
}

export interface AnchorTarget {
  /** Type of external anchor (extensible). */
  type: 'none' | 'worm-snapshot' | 'rekor' | 'opentimestamps' | 'ethereum' | 'solana' | 'composite' | 'custom';
  /** Endpoint or identifier for the anchor target. */
  endpoint?: string;
  /** Additional options specific to the anchor target type. */
  options?: Record<string, unknown>;
  /** For composite: list of sub-targets to publish to in parallel. */
  targets?: AnchorTarget[];
}

// =============================================================================
// Proof Levels
// =============================================================================

/**
 * Ascending trust levels for anchor provenance.
 * Higher ordinal = stronger external proof.
 */
export type ProofLevel =
  | 'verifiable'            // Local signed hash chain only
  | 'externally-archived'   // WORM/S3 Object Lock retention
  | 'publicly-auditable'    // Transparency log (e.g., Rekor)
  | 'publicly-timestamped'; // Blockchain anchor (OTS, Ethereum, Solana)

// =============================================================================
// Anchor Provider
// =============================================================================

/**
 * Result returned by an AnchorProvider after external publishing.
 */
export interface AnchorProviderResult {
  /** Provider identifier (e.g., 'rekor', 'worm-snapshot'). */
  providerId: string;
  /** Whether the external publishing succeeded. */
  success: boolean;
  /** External reference string (CID, UUID, tx hash, URL, etc.). */
  externalRef?: string;
  /** Provider-specific metadata (e.g., block number, log index). */
  metadata?: Record<string, unknown>;
  /** Error message if success is false. */
  error?: string;
  /** ISO 8601 timestamp of when the external publish completed. */
  publishedAt?: string;
}

/**
 * Interface for external anchor publishing backends.
 * Implementations are called AFTER local anchor persistence.
 */
export interface AnchorProvider {
  /** Unique provider identifier. */
  readonly id: string;
  /** Human-readable display name. */
  readonly name: string;
  /** Proof level this provider advertises. */
  readonly proofLevel: ProofLevel;
  /**
   * Publish an anchor externally.
   * Must not throw — failures are returned via AnchorProviderResult.success = false.
   */
  publish(anchor: AnchorRecord): Promise<AnchorProviderResult>;
  /** Optional: verify a previously published anchor against its external reference. */
  verify?(anchor: AnchorRecord): Promise<boolean>;
  /** Optional: dispose of resources (connections, timers, etc.). */
  dispose?(): Promise<void>;
}

// =============================================================================
// Autonomy Config
// =============================================================================

export interface AutonomyConfig {
  /** Whether human prompting is allowed after genesis. */
  allowHumanPrompting: boolean;
  /** Whether humans can edit agent configuration after genesis. */
  allowConfigEdits: boolean;
  /** Whether humans can add/remove tools after genesis. */
  allowToolChanges: boolean;
  /** Whitelist of specific human actions allowed even in restricted mode. */
  allowedHumanActions?: string[];
  /** Genesis event ID (set automatically on first sealed activation). */
  genesisEventId?: string;
}

// =============================================================================
// Top-Level System Config
// =============================================================================

export interface ProvenanceSystemConfig {
  storagePolicy: StoragePolicyConfig;
  provenance: ProvenanceConfig;
  autonomy: AutonomyConfig;
  /** Anchoring interval in milliseconds. 0 = disabled. */
  anchorIntervalMs: number;
  /** Maximum events before a forced anchor is created. 0 = disabled. */
  anchorBatchSize: number;
}

// =============================================================================
// Provenance Event Types
// =============================================================================

export type ProvenanceEventType =
  | 'genesis'
  | 'message.created'
  | 'message.revised'
  | 'message.tombstoned'
  | 'conversation.created'
  | 'conversation.archived'
  | 'conversation.tombstoned'
  | 'tool.invoked'
  | 'tool.result'
  | 'memory.stored'
  | 'memory.revised'
  | 'memory.tombstoned'
  | 'config.changed'
  | 'human.intervention'
  | 'anchor.created'
  | 'guardrail.triggered';

// =============================================================================
// Signed Event (Hash Chain Entry)
// =============================================================================

export interface SignedEvent {
  /** Unique event ID (UUID v4). */
  id: string;
  /** Event type. */
  type: ProvenanceEventType;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Monotonically increasing sequence number within this agent. */
  sequence: number;
  /** Agent instance ID that produced this event. */
  agentId: string;
  /** SHA-256 hash of the previous event (empty string for genesis). */
  prevHash: string;
  /** SHA-256 hash of this event's preimage. */
  hash: string;
  /** SHA-256 hash of the payload JSON. */
  payloadHash: string;
  /** Event-specific payload (JSON-serializable). */
  payload: Record<string, unknown>;
  /** Ed25519 signature of the hash, base64-encoded. */
  signature: string;
  /** Base64-encoded Ed25519 public key of the signing agent. */
  signerPublicKey: string;
  /** Optional: Merkle anchor this event belongs to. */
  anchorId?: string;
}

// =============================================================================
// Anchor Record
// =============================================================================

export interface AnchorRecord {
  /** Unique anchor ID. */
  id: string;
  /** Merkle root hash of events in [sequenceFrom, sequenceTo]. */
  merkleRoot: string;
  /** First event sequence in this anchor. */
  sequenceFrom: number;
  /** Last event sequence in this anchor. */
  sequenceTo: number;
  /** Number of events in this anchor. */
  eventCount: number;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Ed25519 signature of the Merkle root. */
  signature: string;
  /** Optional external reference (IPFS CID, tx hash, etc.). */
  externalRef?: string;
  /** Results from anchor providers (when multiple are composed). */
  providerResults?: AnchorProviderResult[];
}

// =============================================================================
// Revision Record (for revisioned mode)
// =============================================================================

export interface RevisionRecord {
  /** Unique revision ID. */
  id: string;
  /** Table the revised record belongs to. */
  tableName: string;
  /** Primary key of the revised record. */
  recordId: string;
  /** Revision number (1-indexed, monotonically increasing per record). */
  revisionNumber: number;
  /** Complete JSON snapshot of the record at this revision. */
  snapshot: string;
  /** Signed event ID that caused this revision. */
  eventId: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

// =============================================================================
// Tombstone Record (for soft-deletes)
// =============================================================================

export interface TombstoneRecord {
  /** Unique tombstone ID. */
  id: string;
  /** Table the tombstoned record belongs to. */
  tableName: string;
  /** Primary key of the tombstoned record. */
  recordId: string;
  /** Reason for tombstoning. */
  reason: string;
  /** Signed event ID that caused the tombstone. */
  eventId: string;
  /** Who initiated the tombstone (agent ID or 'human'). */
  initiator: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

// =============================================================================
// Agent Key Record (for key persistence)
// =============================================================================

export interface AgentKeyRecord {
  /** Agent instance ID. */
  agentId: string;
  /** Base64-encoded Ed25519 public key. */
  publicKey: string;
  /** Encrypted private key (optional, for server-side storage). */
  encryptedPrivateKey?: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** Key algorithm identifier. */
  keyAlgorithm: string;
}

// =============================================================================
// Verification Types
// =============================================================================

export interface VerificationResult {
  /** Whether all checks passed. */
  valid: boolean;
  /** Number of events verified. */
  eventsVerified: number;
  /** List of errors found. */
  errors: VerificationError[];
  /** Informational warnings (non-fatal). */
  warnings: string[];
  /** First sequence number verified. */
  firstSequence?: number;
  /** Last sequence number verified. */
  lastSequence?: number;
  /** Agent ID of the verified chain. */
  agentId?: string;
  /** ISO 8601 timestamp of when verification was performed. */
  verifiedAt: string;
}

export interface VerificationError {
  /** Event ID where the error was detected. */
  eventId: string;
  /** Sequence number of the problematic event. */
  sequence: number;
  /** Machine-readable error code. */
  code: string;
  /** Human-readable error message. */
  message: string;
}

export interface VerificationBundle {
  /** Bundle format version. */
  version: string;
  /** Agent instance ID. */
  agentId: string;
  /** Base64-encoded Ed25519 public key of the agent. */
  publicKey: string;
  /** Ordered list of signed events. */
  events: SignedEvent[];
  /** Anchor records covering the events. */
  anchors: AnchorRecord[];
  /** ISO 8601 export timestamp. */
  exportedAt: string;
  /** SHA-256 hash of the bundle contents. */
  bundleHash: string;
  /** Ed25519 signature of the bundle hash. */
  bundleSignature: string;
}

// =============================================================================
// Error Types
// =============================================================================

export class ProvenanceViolationError extends Error {
  readonly code: string;
  readonly table?: string;
  readonly operation?: string;

  constructor(message: string, options?: { code?: string; table?: string; operation?: string }) {
    super(message);
    this.name = 'ProvenanceViolationError';
    this.code = options?.code ?? 'PROVENANCE_VIOLATION';
    this.table = options?.table;
    this.operation = options?.operation;
  }
}
