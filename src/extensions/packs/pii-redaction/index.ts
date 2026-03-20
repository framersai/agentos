/**
 * @file index.ts
 * @description Pack factory for the PII Redaction extension pack.
 *
 * This module exports the main `createPiiRedactionPack()` factory function
 * that assembles the guardrail, scan tool, and redact tool into a single
 * {@link ExtensionPack} ready for registration with the AgentOS extension
 * manager.
 *
 * It also exports a `createExtensionPack()` bridge function that conforms to
 * the AgentOS manifest factory convention, delegating to
 * `createPiiRedactionPack()` with options extracted from the
 * {@link ExtensionPackContext}.
 *
 * ### Lifecycle
 *
 * Components are built eagerly at pack creation time for direct programmatic
 * use.  When the pack is activated by the extension manager, the `onActivate`
 * hook rebuilds all components with the manager's shared service registry and
 * secret resolver, ensuring heavyweight services (NLP models, NER weights)
 * are shared across the agent.
 *
 * @module pii-redaction
 */

import type { ISharedServiceRegistry } from '../../ISharedServiceRegistry';
import { SharedServiceRegistry } from '../../SharedServiceRegistry';
import type { ExtensionPack, ExtensionPackContext } from '../../manifest';
import type { ExtensionDescriptor, ExtensionLifecycleContext } from '../../types';
import { EXTENSION_KIND_GUARDRAIL, EXTENSION_KIND_TOOL } from '../../types';
import type { PiiRedactionPackOptions } from './types';
import { PiiRedactionGuardrail } from './PiiRedactionGuardrail';
import { PiiScanTool } from './tools/PiiScanTool';
import { PiiRedactTool } from './tools/PiiRedactTool';

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

/**
 * Re-export all types from the PII redaction type definitions so consumers
 * can import everything from a single entry point:
 * ```ts
 * import { createPiiRedactionPack, PiiEntityType } from './pii-redaction';
 * ```
 */
export * from './types';

// ---------------------------------------------------------------------------
// Pack factory
// ---------------------------------------------------------------------------

/**
 * Create an ExtensionPack that bundles the PII redaction guardrail with
 * the `pii_scan` and `pii_redact` tools.
 *
 * ### Default behaviour (zero-config)
 * When called without options, the pack detects all 18 PII entity types at
 * a confidence threshold of 0.5, redacts using the `placeholder` style
 * (`[EMAIL]`), and evaluates both input and output.
 *
 * ### Activation lifecycle
 * The pack uses mutable internal state (`state.services`, `state.getSecret`)
 * that is upgraded when the extension manager calls `onActivate` with its
 * shared service registry and secret resolver.  All three components
 * (guardrail, scan tool, redact tool) are rebuilt at that point so they
 * share NLP/NER model instances with other extensions.
 *
 * @param options - Optional pack-level configuration.  All properties have
 *                  sensible defaults; see {@link PiiRedactionPackOptions}.
 * @returns A fully-configured {@link ExtensionPack} with one guardrail and
 *          two tools.
 *
 * @example
 * ```ts
 * import { createPiiRedactionPack } from './pii-redaction';
 *
 * const pack = createPiiRedactionPack({
 *   entityTypes: ['EMAIL', 'PHONE', 'SSN'],
 *   redactionStyle: 'mask',
 *   guardrailScope: 'both',
 * });
 * ```
 */
export function createPiiRedactionPack(
  options?: PiiRedactionPackOptions,
): ExtensionPack {
  /** Resolved options (defaults to empty object for zero-config). */
  const opts: PiiRedactionPackOptions = options ?? {};

  // -----------------------------------------------------------------------
  // Mutable state that onActivate can upgrade with the extension manager's
  // shared registry and secret resolver.
  // -----------------------------------------------------------------------

  const state = {
    /** Service registry — starts as a standalone instance, may be replaced. */
    services: new SharedServiceRegistry() as ISharedServiceRegistry,

    /** Secret resolver — initially undefined (no secrets available). */
    getSecret: undefined as ((id: string) => string | undefined) | undefined,
  };

  // -----------------------------------------------------------------------
  // Component instances — rebuilt by buildComponents()
  // -----------------------------------------------------------------------

  /** The guardrail service instance. */
  let guardrail: PiiRedactionGuardrail;

  /** The PII scan tool instance. */
  let scanTool: PiiScanTool;

  /** The PII redact tool instance. */
  let redactTool: PiiRedactTool;

  /**
   * (Re)build all three pack components using the current `state.services`
   * and `state.getSecret`.  Called once at pack creation and again during
   * `onActivate` to upgrade to the shared registry.
   */
  function buildComponents(): void {
    guardrail = new PiiRedactionGuardrail(state.services, opts, state.getSecret);
    scanTool = new PiiScanTool(state.services, opts);
    redactTool = new PiiRedactTool(state.services, opts);
  }

  // Initial build for direct programmatic use (before activation).
  buildComponents();

  // -----------------------------------------------------------------------
  // ExtensionPack shape
  // -----------------------------------------------------------------------

  return {
    /** Canonical pack name used in manifests and logs. */
    name: 'pii-redaction',

    /** Semantic version of the pack. */
    version: '1.0.0',

    /**
     * Descriptors getter — returns the current component instances wrapped
     * in the ExtensionDescriptor shape.  Uses a getter so that descriptors
     * always reflect the latest (potentially rebuilt) component references.
     */
    get descriptors(): ExtensionDescriptor[] {
      return [
        {
          id: 'pii-redaction-guardrail',
          kind: EXTENSION_KIND_GUARDRAIL,
          priority: 10,
          payload: guardrail,
        },
        {
          id: 'pii_scan',
          kind: EXTENSION_KIND_TOOL,
          priority: 0,
          payload: scanTool,
        },
        {
          id: 'pii_redact',
          kind: EXTENSION_KIND_TOOL,
          priority: 0,
          payload: redactTool,
        },
      ];
    },

    /**
     * Lifecycle hook called by the extension manager when the pack is
     * activated.  Upgrades the shared service registry and secret resolver
     * to the manager's instances, then rebuilds all components so they
     * share heavyweight services (NLP models, NER weights) with the rest
     * of the agent.
     *
     * @param context - Activation context provided by the extension manager.
     */
    onActivate: (context: ExtensionLifecycleContext): void => {
      // Upgrade the service registry if the manager provides one.
      if (context.services) {
        state.services = context.services;
      }

      // Upgrade the secret resolver if the manager provides one.
      if (context.getSecret) {
        state.getSecret = context.getSecret;
      }

      // Rebuild all components with the upgraded state.
      buildComponents();
    },
  };
}

// ---------------------------------------------------------------------------
// Manifest factory bridge
// ---------------------------------------------------------------------------

/**
 * AgentOS manifest factory function.
 *
 * This function conforms to the convention expected by the extension loader
 * when resolving packs from manifests.  It extracts `options` from the
 * {@link ExtensionPackContext} and delegates to {@link createPiiRedactionPack}.
 *
 * @param context - Manifest context containing optional pack options, secret
 *                  resolver, and shared service registry.
 * @returns A fully-configured {@link ExtensionPack}.
 *
 * @example
 * ```ts
 * // In an AgentOS manifest:
 * {
 *   "packs": [
 *     { "module": "./pii-redaction", "options": { "redactionStyle": "hash" } }
 *   ]
 * }
 * ```
 */
export function createExtensionPack(context: ExtensionPackContext): ExtensionPack {
  return createPiiRedactionPack(context.options as PiiRedactionPackOptions);
}
