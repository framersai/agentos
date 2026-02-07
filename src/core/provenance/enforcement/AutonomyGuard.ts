/**
 * @file AutonomyGuard.ts
 * @description Enforces autonomy rules in sealed mode.
 * Blocks human input/prompting after genesis, logs all human interventions.
 *
 * @module AgentOS/Provenance/Enforcement
 */

import type { AutonomyConfig, ProvenanceSystemConfig } from '../types.js';
import { ProvenanceViolationError } from '../types.js';
import type { SignedEventLedger } from '../ledger/SignedEventLedger.js';

// =============================================================================
// AutonomyGuard
// =============================================================================

export class AutonomyGuard {
  private readonly config: AutonomyConfig;
  private readonly ledger: SignedEventLedger | null;
  private genesisRecorded: boolean = false;

  constructor(config: AutonomyConfig, ledger: SignedEventLedger | null = null) {
    this.config = config;
    this.ledger = ledger;
    this.genesisRecorded = !!config.genesisEventId;
  }

  /**
   * Check if a human action is allowed under the current autonomy config.
   * Throws ProvenanceViolationError if the action is blocked.
   *
   * @param actionType - Type of human action (e.g., 'prompt', 'edit_config', 'add_tool', 'pause', 'stop')
   * @param details - Optional details about the action
   */
  async checkHumanAction(
    actionType: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.genesisRecorded) {
      // Before genesis, all human actions are allowed
      return;
    }

    // Check whitelist first
    if (this.config.allowedHumanActions?.includes(actionType)) {
      // Allowed but log it
      if (this.ledger) {
        await this.ledger.appendEvent('human.intervention', {
          interventionType: actionType,
          allowed: true,
          details,
        });
      }
      return;
    }

    // Check specific permissions
    switch (actionType) {
      case 'prompt':
      case 'user_message':
      case 'human_input':
        if (!this.config.allowHumanPrompting) {
          throw new ProvenanceViolationError(
            `Human prompting is blocked in sealed autonomous mode. Action: ${actionType}`,
            { code: 'AUTONOMY_HUMAN_PROMPT_BLOCKED', operation: actionType },
          );
        }
        break;

      case 'edit_config':
      case 'config_change':
        if (!this.config.allowConfigEdits) {
          throw new ProvenanceViolationError(
            `Configuration changes are blocked in sealed autonomous mode.`,
            { code: 'AUTONOMY_CONFIG_EDIT_BLOCKED', operation: actionType },
          );
        }
        break;

      case 'add_tool':
      case 'remove_tool':
      case 'tool_change':
        if (!this.config.allowToolChanges) {
          throw new ProvenanceViolationError(
            `Tool changes are blocked in sealed autonomous mode.`,
            { code: 'AUTONOMY_TOOL_CHANGE_BLOCKED', operation: actionType },
          );
        }
        break;

      default:
        // Unknown action types are blocked by default in sealed mode
        // unless explicitly in the allowedHumanActions list
        if (!this.config.allowHumanPrompting) {
          throw new ProvenanceViolationError(
            `Human action '${actionType}' is blocked in sealed autonomous mode.`,
            { code: 'AUTONOMY_ACTION_BLOCKED', operation: actionType },
          );
        }
    }

    // Log the allowed action
    if (this.ledger) {
      await this.ledger.appendEvent('human.intervention', {
        interventionType: actionType,
        allowed: true,
        details,
      });
    }
  }

  /**
   * Record the genesis event, marking the start of sealed autonomous operation.
   */
  async recordGenesis(genesisEventId: string): Promise<void> {
    this.config.genesisEventId = genesisEventId;
    this.genesisRecorded = true;
  }

  /**
   * Check if genesis has been recorded.
   */
  isSealed(): boolean {
    return this.genesisRecorded;
  }

  /**
   * Check whether a specific action type would be blocked.
   * Returns true if the action is allowed, false if it would be blocked.
   */
  wouldAllow(actionType: string): boolean {
    if (!this.genesisRecorded) return true;
    if (this.config.allowedHumanActions?.includes(actionType)) return true;

    switch (actionType) {
      case 'prompt':
      case 'user_message':
      case 'human_input':
        return this.config.allowHumanPrompting;
      case 'edit_config':
      case 'config_change':
        return this.config.allowConfigEdits;
      case 'add_tool':
      case 'remove_tool':
      case 'tool_change':
        return this.config.allowToolChanges;
      default:
        return this.config.allowHumanPrompting;
    }
  }
}
