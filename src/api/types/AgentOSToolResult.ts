/**
 * Host-provided result for one externally executed tool call.
 */
export interface AgentOSToolResultInput {
  toolCallId: string;
  toolName: string;
  toolOutput: any;
  isSuccess: boolean;
  errorMessage?: string;
}
