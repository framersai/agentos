import type { ExtensionDescriptor, ExtensionKind, ExtensionSourceMetadata } from './types';

export type ExtensionEventType =
  | 'pack:loaded'
  | 'pack:failed'
  | 'descriptor:activated'
  | 'descriptor:deactivated';

export interface ExtensionEventBase {
  type: ExtensionEventType;
  timestamp: string;
}

export interface ExtensionPackEvent extends ExtensionEventBase {
  type: 'pack:loaded' | 'pack:failed';
  source: ExtensionSourceMetadata;
  error?: Error;
}

export interface ExtensionDescriptorEvent<TPayload = unknown> extends ExtensionEventBase {
  type: 'descriptor:activated' | 'descriptor:deactivated';
  descriptor: ExtensionDescriptor<TPayload>;
  kind: ExtensionKind;
}

export type ExtensionEvent<TPayload = unknown> =
  | ExtensionPackEvent
  | ExtensionDescriptorEvent<TPayload>;

export type ExtensionEventListener = (event: ExtensionEvent) => void;
