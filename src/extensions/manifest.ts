import type { ExtensionDescriptor, ExtensionSourceMetadata } from './types';

export type ExtensionPackResolver =
  | { package: string; version?: string }
  | { module: string }
  | { factory: () => Promise<ExtensionPack> | ExtensionPack };

export type ExtensionPackManifestEntry = ExtensionPackResolver & {
  /**
   * Priority applied to descriptors emitted by this pack unless they override it individually.
   */
  priority?: number;
  /**
   * Allows enabling/disabling the entire pack via manifest.
   */
  enabled?: boolean;
  /**
   * Optional configuration payload passed to the pack factory.
   */
  options?: Record<string, unknown>;
  /**
   * Identifier for diagnostics (e.g. file path within manifest).
   */
  identifier?: string;
};

export interface ExtensionManifest {
  packs: ExtensionPackManifestEntry[];
  overrides?: ExtensionOverrides;
}

export interface ExtensionOverrides {
  tools?: Record<string, DescriptorOverride>;
  guardrails?: Record<string, DescriptorOverride>;
  responses?: Record<string, DescriptorOverride>;
}

export interface DescriptorOverride {
  enabled?: boolean;
  priority?: number;
  options?: Record<string, unknown>;
}

export interface ExtensionPackContext {
  manifestEntry: ExtensionPackManifestEntry;
  source: ExtensionSourceMetadata;
  options?: Record<string, unknown>;
}

export interface ExtensionPack {
  name: string;
  version?: string;
  descriptors: ExtensionDescriptor[];
}
