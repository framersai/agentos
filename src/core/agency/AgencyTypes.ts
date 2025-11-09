/**
 * Captures the runtime state of a single seat within an Agency.
 */
export interface AgencySeatState {
  roleId: string;
  gmiInstanceId: string;
  personaId: string;
  attachedAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Represents a collective of GMIs collaborating under a single Agency identity.
 */
export interface AgencySession {
  agencyId: string;
  workflowId: string;
  conversationId: string;
  createdAt: string;
  updatedAt: string;
  seats: Record<string, AgencySeatState>;
  metadata?: Record<string, unknown>;
}

export interface AgencyUpsertArgs {
  workflowId: string;
  conversationId: string;
  agencyId?: string;
  metadata?: Record<string, unknown>;
}

export interface AgencySeatRegistrationArgs {
  agencyId: string;
  roleId: string;
  gmiInstanceId: string;
  personaId: string;
  metadata?: Record<string, unknown>;
}
