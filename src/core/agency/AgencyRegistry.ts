import { v4 as uuidv4 } from 'uuid';

import type { ILogger } from '../../logging/ILogger';
import type {
  AgencySeatRegistrationArgs,
  AgencySeatState,
  AgencySession,
  AgencyUpsertArgs,
} from './AgencyTypes';

/**
 * Tracks the Agencies (multi-GMI collectives) active inside the AgentOS runtime.
 * @remarks
 * The registry is intentionally ephemeral; durable state should be captured via workflow persistence.
 */
export class AgencyRegistry {
  private readonly agencies = new Map<string, AgencySession>();
  private readonly workflowToAgency = new Map<string, string>();

  constructor(private readonly logger?: ILogger) {}

  /**
   * Creates or updates an agency session associated with a workflow.
   * @param args - Upsert payload containing workflow linkage and optional metadata.
   * @returns The upserted agency session.
   */
  public upsertAgency(args: AgencyUpsertArgs): AgencySession {
    const existingId = args.agencyId ?? this.workflowToAgency.get(args.workflowId);
    const now = new Date().toISOString();
    if (existingId && this.agencies.has(existingId)) {
      const session = this.agencies.get(existingId)!;
      session.updatedAt = now;
      session.metadata = {
        ...session.metadata,
        ...args.metadata,
      };
      this.workflowToAgency.set(args.workflowId, session.agencyId);
      return session;
    }

    const agencyId = existingId ?? `agency-${uuidv4()}`;
    const session: AgencySession = {
      agencyId,
      workflowId: args.workflowId,
      conversationId: args.conversationId,
      createdAt: now,
      updatedAt: now,
      seats: {},
      metadata: args.metadata ?? {},
    };
    this.agencies.set(agencyId, session);
    this.workflowToAgency.set(args.workflowId, agencyId);
    this.logger?.info?.('Created Agency session', {
      agencyId,
      workflowId: args.workflowId,
      conversationId: args.conversationId,
    });
    return session;
  }

  /**
   * Retrieves an agency session by identifier.
   * @param agencyId - Target Agency identifier.
   * @returns The matching agency session or `undefined` when absent.
   */
  public getAgency(agencyId: string): AgencySession | undefined {
    return this.agencies.get(agencyId);
  }

  /**
   * Resolves the agency session associated with a workflow instance (if any).
   * @param workflowId - Workflow instance identifier.
   * @returns The agency session mapped to the workflow, if present.
   */
  public getAgencyByWorkflow(workflowId: string): AgencySession | undefined {
    const agencyId = this.workflowToAgency.get(workflowId);
    return agencyId ? this.agencies.get(agencyId) : undefined;
  }

  /**
   * Registers or updates a seat inside the agency.
   * @param args - Seat registration payload.
   * @returns Updated agency session after the seat registration.
   * @throws {Error} When attempting to register against an unknown agency.
   */
  public registerSeat(args: AgencySeatRegistrationArgs): AgencySession {
    const session = this.getAgency(args.agencyId);
    if (!session) {
      throw new Error(`AgencyRegistry.registerSeat called with unknown agencyId '${args.agencyId}'.`);
    }
    const now = new Date().toISOString();
    const seat: AgencySeatState = {
      roleId: args.roleId,
      gmiInstanceId: args.gmiInstanceId,
      personaId: args.personaId,
      metadata: args.metadata,
      attachedAt: now,
    };
    session.seats[args.roleId] = seat;
    session.updatedAt = now;
    this.logger?.debug?.('Registered Agency seat', {
      agencyId: args.agencyId,
      roleId: args.roleId,
      gmiInstanceId: args.gmiInstanceId,
    });
    return session;
  }

  /**
   * Removes an agency entirely (e.g., when the workflow reaches a terminal state).
   * @param agencyId - Agency identifier to remove.
   * @returns `true` when the agency existed and was removed.
   */
  public removeAgency(agencyId: string): boolean {
    const session = this.agencies.get(agencyId);
    if (!session) {
      return false;
    }
    this.agencies.delete(agencyId);
    this.workflowToAgency.delete(session.workflowId);
    this.logger?.info?.('Removed Agency session', {
      agencyId,
      workflowId: session.workflowId,
    });
    return true;
  }
}
