import { parseToolCallsFromText } from './TextToolCallParser.js';

export interface SyntheticToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export type DynamicToolCallLike = {
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
};

export function buildSyntheticToolCallsFromText(
  text: string,
  step: number,
): SyntheticToolCall[] {
  return parseToolCallsFromText(text).map((toolCall, index) => ({
    id: `text-tc-${step}-${index}`,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    },
  }));
}

export function resolveDynamicToolCalls<T extends DynamicToolCallLike>(
  toolCalls: ReadonlyArray<T> | undefined,
  options: {
    text: string | undefined;
    step: number;
    toolsAvailable: boolean;
  },
): Array<T | SyntheticToolCall> {
  if (toolCalls && toolCalls.length > 0) {
    return [...toolCalls];
  }

  if (!options.toolsAvailable || !options.text) {
    return [];
  }

  return buildSyntheticToolCallsFromText(options.text, options.step);
}
