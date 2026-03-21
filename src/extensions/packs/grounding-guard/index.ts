/**
 * @file index.ts
 * @description Pack factory for the Grounding Guard extension pack.
 *
 * Exports the main `createGroundingGuardPack()` factory function that
 * assembles the {@link GroundingGuardrail} guardrail and the
 * {@link CheckGroundingTool} tool into a single {@link ExtensionPack}
 * ready for registration with the AgentOS extension manager.
 *
 * Also exports a `createExtensionPack()` bridge function that conforms to
 * the AgentOS manifest factory convention, delegating to
 * `createGroundingGuardPack()` with options extracted from the
 * {@link ExtensionPackContext}.
 *
 * ### Lifecycle
 *
 * Components are built eagerly at pack creation time for direct programmatic
 * use.  When the pack is activated by the extension manager, the `onActivate`
 * hook rebuilds all components with the manager's shared service registry and
 * secret resolver, ensuring heavyweight services (NLI ONNX models) are shared
 * across the agent.
 *
 * On deactivation, `onDeactivate` disposes the NLI pipeline via
 * {@link GroundingChecker.dispose} and clears per-stream buffers via
 * {@link GroundingGuardrail.clearBuffers}.
 *
 * ### Default behaviour (zero-config)
 *
 * When called without options, the pack uses `cross-encoder/nli-deberta-v3-small`
 * with standard thresholds (0.7 entailment, 0.7 contradiction), flags (rather
 * than blocks) contradicted output, and evaluates streaming chunks in real-time.
 *
 * @module agentos/extensions/packs/grounding-guard
 */

import type { ISharedServiceRegistry } from '../../ISharedServiceRegistry';
import { SharedServiceRegistry } from '../../SharedServiceRegistry';
import type { ExtensionPack, ExtensionPackContext } from '../../manifest';
import type { ExtensionDescriptor, ExtensionLifecycleContext } from '../../types';
import { EXTENSION_KIND_GUARDRAIL, EXTENSION_KIND_TOOL } from '../../types';
import type { GroundingGuardOptions } from './types';
import { ClaimExtractor } from './ClaimExtractor';
import { GroundingChecker } from './GroundingChecker';
import { GroundingGuardrail } from './GroundingGuardrail';
import { CheckGroundingTool } from './tools/CheckGroundingTool';

// ---------------------------------------------------------------------------
// Re-exports — allow single-import for consumers
// ---------------------------------------------------------------------------

/**
 * Re-export all types from the grounding guard type definitions so consumers
 * can import everything from a single entry point:
 * ```ts
 * import { createGroundingGuardPack, GroundingGuardOptions } from './grounding-guard';
 * ```
 */
export * from './types';

// ---------------------------------------------------------------------------
// Pack factory
// ---------------------------------------------------------------------------

/**
 * Create an {@link ExtensionPack} that bundles:
 *  - The {@link GroundingGuardrail} guardrail (streaming + final verification).
 *  - The {@link CheckGroundingTool} `check_grounding` tool (on-demand verification).
 *
 * ### Activation lifecycle
 *
 * The pack uses mutable internal state (`state.services`, `state.getSecret`)
 * that is upgraded when the extension manager calls `onActivate` with its
 * shared service registry and secret resolver.  Both components (guardrail
 * and tool) are rebuilt at that point so they share NLI model instances with
 * other extensions.
 *
 * @param options - Optional pack-level configuration.  All properties have
 *                  sensible defaults; see {@link GroundingGuardOptions}.
 * @returns A fully-configured {@link ExtensionPack} with one guardrail and
 *          one tool.
 *
 * @example
 * ```typescript
 * import { createGroundingGuardPack } from './grounding-guard';
 *
 * // Zero-config — uses default NLI model and thresholds:
 * const pack = createGroundingGuardPack();
 *
 * // Custom thresholds and block action:
 * const strictPack = createGroundingGuardPack({
 *   entailmentThreshold: 0.8,
 *   contradictionAction: 'block',
 *   maxUnverifiableRatio: 0.3,
 * });
 * ```
 */
export function createGroundingGuardPack(
  options?: GroundingGuardOptions,
): ExtensionPack {
  /** Resolved options (defaults to empty object for zero-config). */
  const opts: GroundingGuardOptions = options ?? {};

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

  /** The grounding guardrail service instance. */
  let guardrail: GroundingGuardrail;

  /** The on-demand grounding check tool instance. */
  let tool: CheckGroundingTool;

  /** The NLI-based grounding checker (shared between guardrail and tool). */
  let checker: GroundingChecker;

  /** The claim extractor (shared between guardrail and tool). */
  let extractor: ClaimExtractor;

  // -----------------------------------------------------------------------
  // LLM resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve the LLM callable from the pack options.
   *
   * Returns the `opts.llm` function if configured, or `undefined` if no LLM
   * is available.  This function is called during `buildComponents()` so that
   * each rebuild picks up any changes to the LLM configuration.
   *
   * @returns The LLM callable or `undefined`.
   */
  function resolveLlmFn(): ((prompt: string) => Promise<string>) | undefined {
    return opts.llm;
  }

  // -----------------------------------------------------------------------
  // buildComponents
  // -----------------------------------------------------------------------

  /**
   * (Re)build all pack components using the current `state.services` and
   * `state.getSecret`.
   *
   * Called once at pack creation for direct programmatic use, and again
   * during `onActivate` to upgrade to the extension manager's shared
   * service registry (so ONNX/WASM NLI pipeline is shared across the agent).
   */
  function buildComponents(): void {
    // Resolve the LLM function from options.
    const llmFn = resolveLlmFn();

    // Build the claim extractor with the resolved LLM function.
    extractor = new ClaimExtractor(llmFn);

    // Build the grounding checker with the current shared registry.
    checker = new GroundingChecker(state.services, {
      nliModelId: opts.nliModelId,
      entailmentThreshold: opts.entailmentThreshold,
      contradictionThreshold: opts.contradictionThreshold,
      llmFn,
      maxSourcesPerClaim: opts.maxSourcesPerClaim,
      quantized: opts.quantized,
    });

    // Build the guardrail with the current shared registry and options.
    guardrail = new GroundingGuardrail(state.services, opts);

    // Build the on-demand check tool backed by the checker and extractor.
    tool = new CheckGroundingTool(checker, extractor);
  }

  // Initial build — makes the pack usable immediately without activation.
  buildComponents();

  // -----------------------------------------------------------------------
  // ExtensionPack shape
  // -----------------------------------------------------------------------

  return {
    /** Canonical pack name used in manifests and logs. */
    name: 'grounding-guard',

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
          /**
           * Guardrail descriptor.
           *
           * Priority 8 places this guardrail after the PII redaction guardrail
           * (priority 10) and above the ML classifier guardrail (priority 5)
           * so PII is stripped before grounding checks run.
           */
          id: 'grounding-guardrail',
          kind: EXTENSION_KIND_GUARDRAIL,
          priority: 8,
          payload: guardrail,
        },
        {
          /**
           * On-demand grounding check tool descriptor.
           *
           * Priority 0 uses the default ordering — tools are typically
           * ordered by name rather than priority.
           */
          id: 'check_grounding',
          kind: EXTENSION_KIND_TOOL,
          priority: 0,
          payload: tool,
        },
      ];
    },

    /**
     * Lifecycle hook called by the extension manager when the pack is
     * activated.
     *
     * Upgrades the internal service registry and secret resolver to the
     * extension manager's shared instances, then rebuilds all components so
     * they share the NLI ONNX pipeline with the rest of the agent.
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

    /**
     * Lifecycle hook called when the pack is deactivated or the agent shuts
     * down.
     *
     * Disposes the NLI pipeline via {@link GroundingChecker.dispose} and
     * clears per-stream sentence buffers via
     * {@link GroundingGuardrail.clearBuffers} to release memory.
     */
    onDeactivate: async (): Promise<void> => {
      // Dispose the NLI pipeline managed by the checker.
      // checker may be undefined if buildComponents() was never called
      // successfully (defensive guard).
      if (checker) {
        await checker.dispose();
      }

      // Clear any in-progress stream buffers.
      if (guardrail) {
        guardrail.clearBuffers();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Manifest factory bridge
// ---------------------------------------------------------------------------

/**
 * AgentOS manifest factory function.
 *
 * Conforms to the convention expected by the extension loader when resolving
 * packs from manifests.  Extracts `options` from the {@link ExtensionPackContext}
 * and delegates to {@link createGroundingGuardPack}.
 *
 * @param context - Manifest context containing optional pack options, secret
 *                  resolver, and shared service registry.
 * @returns A fully-configured {@link ExtensionPack}.
 *
 * @example Manifest entry:
 * ```json
 * {
 *   "packs": [
 *     {
 *       "module": "./grounding-guard",
 *       "options": {
 *         "contradictionAction": "block",
 *         "maxUnverifiableRatio": 0.3
 *       }
 *     }
 *   ]
 * }
 * ```
 */
export function createExtensionPack(context: ExtensionPackContext): ExtensionPack {
  return createGroundingGuardPack(context.options as GroundingGuardOptions);
}
