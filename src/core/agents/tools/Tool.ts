/**
 * Lightweight tool definition wrapper used by legacy agent helpers.
 * Real tool metadata lives in core/tools; this file provides a minimal
 * structure so AgentCore/AgentPoolAgent can describe tools without pulling
 * in heavier dependencies.
 */

export interface ToolDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Tool {
  id: string;
  definition: ToolDefinition;
}
