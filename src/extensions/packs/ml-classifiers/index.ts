/**
 * @fileoverview Pack factory for the ML Classifier Guardrail Extension Pack.
 *
 * Exports the main `createMLClassifierPack()` factory that assembles the
 * ML classifier guardrail and the `classify_content` tool into a single
 * {@link ExtensionPack} ready for registration with the AgentOS extension
 * manager.
 *
 * Also exports a `createExtensionPack()` bridge function that conforms to
 * the AgentOS manifest factory convention, delegating to
 * `createMLClassifierPack()` with options extracted from the
 * {@link ExtensionPackContext}.
 *
 * ### Default behaviour (zero-config)
 * When called without arguments, all three built-in classifiers (toxicity,
 * prompt-injection, jailbreak) are active using their default model IDs and
 * the default threshold set:
 *  - block at 0.90 confidence
 *  - flag at 0.70 confidence
 *  - warn (sanitize) at 0.40 confidence
 *
 * ### Activation lifecycle
 * Components are built eagerly at pack creation time for direct programmatic
 * use.  When the extension manager activates the pack, `onActivate` rebuilds
 * all components with the manager's shared service registry so heavyweight
 * resources (ONNX/WASM model pipelines) are shared across the agent.
 *
 * ### Disabling classifiers
 * Individual classifiers can be disabled by omitting them from the
 * `options.classifiers` array.  An empty array or `undefined` activates all
 * three built-in classifiers.
 *
 * @example
 * ```typescript
 * import { createMLClassifierPack } from './ml-classifiers';
 *
 * // All built-in classifiers at default thresholds:
 * const pack = createMLClassifierPack();
 *
 * // Toxicity only with custom block threshold:
 * const strictPack = createMLClassifierPack({
 *   classifiers: ['toxicity'],
 *   thresholds: { blockThreshold: 0.85 },
 *   streamingMode: true,
 *   guardrailScope: 'both',
 * });
 * ```
 *
 * @module agentos/extensions/packs/ml-classifiers
 */

import type { ISharedServiceRegistry } from '../../ISharedServiceRegistry';
import { SharedServiceRegistry } from '../../SharedServiceRegistry';
import type { ExtensionPack, ExtensionPackContext } from '../../manifest';
import type { ExtensionDescriptor, ExtensionLifecycleContext } from '../../types';
import { EXTENSION_KIND_GUARDRAIL, EXTENSION_KIND_TOOL } from '../../types';
import type { MLClassifierPackOptions } from './types';
import { DEFAULT_THRESHOLDS } from './types';
import { MLClassifierGuardrail } from './MLClassifierGuardrail';
import { ClassifierOrchestrator } from './ClassifierOrchestrator';
import { SlidingWindowBuffer } from './SlidingWindowBuffer';
import { ClassifyContentTool } from './tools/ClassifyContentTool';
import { ToxicityClassifier } from './classifiers/ToxicityClassifier';
import { InjectionClassifier } from './classifiers/InjectionClassifier';
import { JailbreakClassifier } from './classifiers/JailbreakClassifier';
import type { IContentClassifier } from './IContentClassifier';

// ---------------------------------------------------------------------------
// Re-exports — allow single-import for consumers
// ---------------------------------------------------------------------------

/**
 * Re-export all types from the ML classifier type definitions so consumers
 * can import everything from a single entry point:
 * ```ts
 * import { createMLClassifierPack, DEFAULT_THRESHOLDS } from './ml-classifiers';
 * ```
 */
export * from './types';

// ---------------------------------------------------------------------------
// Pack factory
// ---------------------------------------------------------------------------

/**
 * Create an {@link ExtensionPack} that bundles:
 *  - The {@link MLClassifierGuardrail} guardrail (evaluates input & output).
 *  - The {@link ClassifyContentTool} `classify_content` tool (on-demand analysis).
 *
 * The built-in classifiers that are instantiated depend on `options.classifiers`:
 *  - `'toxicity'`  → {@link ToxicityClassifier}   (`unitary/toxic-bert`)
 *  - `'injection'` → {@link InjectionClassifier}  (`protectai/deberta-v3-small-prompt-injection-v2`)
 *  - `'jailbreak'` → {@link JailbreakClassifier}  (`meta-llama/PromptGuard-86M`)
 *
 * When `options.classifiers` is `undefined` or empty, **all three** are active.
 *
 * Additional classifiers supplied via `options.customClassifiers` are appended
 * to the active list and run in parallel alongside the built-in ones.
 *
 * @param options - Optional pack-level configuration.  All properties have
 *                  sensible defaults; see {@link MLClassifierPackOptions}.
 * @returns A fully-configured {@link ExtensionPack} with one guardrail
 *          descriptor and one tool descriptor.
 */
export function createMLClassifierPack(options?: MLClassifierPackOptions): ExtensionPack {
  /**
   * Resolved options — default to empty object so every sub-check can
   * safely use `opts.foo` without null-guarding the whole `options` reference.
   */
  const opts: MLClassifierPackOptions = options ?? {};

  // -------------------------------------------------------------------------
  // Mutable state — upgraded by onActivate with the extension manager's
  // shared service registry.
  // -------------------------------------------------------------------------

  const state = {
    /**
     * Service registry — starts as a standalone instance so the pack can be
     * used directly (without activation) in unit tests and scripts.
     * Replaced with the shared registry when `onActivate` is called by the
     * extension manager.
     */
    services: new SharedServiceRegistry() as ISharedServiceRegistry,
  };

  // -------------------------------------------------------------------------
  // Component instances — rebuilt by buildComponents()
  // -------------------------------------------------------------------------

  /**
   * The guardrail that evaluates user input and/or agent output streams
   * against all active ML classifiers.
   */
  let guardrail: MLClassifierGuardrail;

  /**
   * The on-demand classification tool exposed to agents and workflows.
   */
  let tool: ClassifyContentTool;

  /**
   * The orchestrator that runs all active classifiers in parallel and folds
   * their results into a single {@link ChunkEvaluation} via worst-wins
   * aggregation.
   */
  let orchestrator: ClassifierOrchestrator;

  /**
   * The sliding-window buffer used internally by the guardrail to evaluate
   * streamed output tokens incrementally.
   */
  let buffer: SlidingWindowBuffer;

  // -------------------------------------------------------------------------
  // buildComponents
  // -------------------------------------------------------------------------

  /**
   * (Re)construct all pack components using the current `state.services`.
   *
   * Called once at pack creation for direct programmatic use, and again
   * during `onActivate` to upgrade to the extension manager's shared
   * service registry (so ONNX/WASM pipelines are shared across the agent).
   *
   * ### Classifier selection
   * The active classifiers are determined by `opts.classifiers`:
   *  - `undefined` or empty → all three built-in classifiers are created.
   *  - Non-empty array      → only the named classifiers are created.
   *
   * Any `opts.customClassifiers` are always appended to the list.
   */
  function buildComponents(): void {
    // ------------------------------------------------------------------
    // 1. Determine which built-in classifiers to instantiate.
    // ------------------------------------------------------------------

    /**
     * Determine whether a given built-in classifier name is enabled.
     *
     * When `opts.classifiers` is undefined or an empty array every built-in
     * classifier is considered enabled (zero-config default).
     *
     * @param name - One of `'toxicity'`, `'injection'`, or `'jailbreak'`.
     * @returns `true` when the classifier should be included.
     */
    function isBuiltInEnabled(name: 'toxicity' | 'injection' | 'jailbreak'): boolean {
      // No explicit list — enable all built-in classifiers.
      if (!opts.classifiers || opts.classifiers.length === 0) {
        return true;
      }
      return opts.classifiers.includes(name);
    }

    /** Array that will be populated with every active IContentClassifier. */
    const activeClassifiers: IContentClassifier[] = [];

    // Toxicity classifier — detects hateful, abusive, and toxic language.
    if (isBuiltInEnabled('toxicity')) {
      activeClassifiers.push(new ToxicityClassifier(state.services));
    }

    // Injection classifier — detects prompt-injection payloads.
    if (isBuiltInEnabled('injection')) {
      activeClassifiers.push(new InjectionClassifier(state.services));
    }

    // Jailbreak classifier — detects system-prompt override attempts.
    if (isBuiltInEnabled('jailbreak')) {
      activeClassifiers.push(new JailbreakClassifier(state.services));
    }

    // Append any caller-supplied custom classifiers.
    if (opts.customClassifiers && opts.customClassifiers.length > 0) {
      activeClassifiers.push(...opts.customClassifiers);
    }

    // ------------------------------------------------------------------
    // 2. Resolve pack-level thresholds (merge caller overrides on top of
    //    the library defaults).
    // ------------------------------------------------------------------

    const thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...opts.thresholds,
    };

    // ------------------------------------------------------------------
    // 3. Build the orchestrator with the resolved classifier list and
    //    thresholds.
    // ------------------------------------------------------------------
    orchestrator = new ClassifierOrchestrator(activeClassifiers, thresholds);

    // ------------------------------------------------------------------
    // 4. Build the sliding-window buffer for streaming evaluation.
    // ------------------------------------------------------------------
    buffer = new SlidingWindowBuffer({
      chunkSize: opts.chunkSize,
      contextSize: opts.contextSize,
      maxEvaluations: opts.maxEvaluations,
    });

    // ------------------------------------------------------------------
    // 5. Build the guardrail, passing the shared registry and options.
    //    The guardrail creates its own orchestrator internally from the
    //    `classifiers` option — we pass the pre-built classifier instances
    //    via the third constructor argument.
    // ------------------------------------------------------------------
    guardrail = new MLClassifierGuardrail(state.services, opts, activeClassifiers);

    // ------------------------------------------------------------------
    // 6. Build the on-demand classification tool backed by the orchestrator.
    // ------------------------------------------------------------------
    tool = new ClassifyContentTool(orchestrator);
  }

  // Initial build — makes the pack usable immediately without activation.
  buildComponents();

  // -------------------------------------------------------------------------
  // ExtensionPack shape
  // -------------------------------------------------------------------------

  return {
    /** Canonical pack name used in manifests and logs. */
    name: 'ml-classifiers',

    /** Semantic version of this pack implementation. */
    version: '1.0.0',

    /**
     * Descriptor getter — always returns the latest (possibly rebuilt)
     * component instances.  Using a getter ensures that after `onActivate`
     * rebuilds the components, the descriptors array reflects the new
     * references rather than stale closures from the initial build.
     */
    get descriptors(): ExtensionDescriptor[] {
      return [
        {
          /**
           * Guardrail descriptor.
           *
           * Priority 5 places this guardrail after the PII redaction guardrail
           * (priority 10) so PII is stripped before ML classification.
           */
          id: 'ml-classifier-guardrail',
          kind: EXTENSION_KIND_GUARDRAIL,
          priority: 5,
          payload: guardrail,
        },
        {
          /**
           * On-demand classification tool descriptor.
           *
           * Priority 0 uses the default ordering — tools are typically
           * ordered by name rather than priority.
           */
          id: 'classify_content',
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
     * Upgrades the internal service registry to the extension manager's
     * shared instance (so ONNX/WASM model weights are shared across all
     * extensions) then rebuilds all components to use the new registry.
     *
     * @param context - Activation context provided by the extension manager.
     */
    onActivate: (context: ExtensionLifecycleContext): void => {
      // Upgrade to the shared registry when the manager provides one.
      if (context.services) {
        state.services = context.services;
      }

      // Rebuild all components with the upgraded registry.
      buildComponents();
    },

    /**
     * Lifecycle hook called when the pack is deactivated or the agent shuts
     * down.
     *
     * Disposes the classifier orchestrator (which releases ONNX/WASM
     * resources for every registered classifier) and clears the sliding
     * window buffer to release per-stream state.
     */
    onDeactivate: async (): Promise<void> => {
      // Dispose all classifiers managed by the orchestrator.
      // orchestrator may be undefined if buildComponents() was never called
      // successfully (defensive guard).
      if (orchestrator) {
        await orchestrator.dispose();
      }

      // Clear any in-progress stream buffers.
      if (buffer) {
        buffer.clear();
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
 * and delegates to {@link createMLClassifierPack}.
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
 *       "module": "./ml-classifiers",
 *       "options": {
 *         "classifiers": ["toxicity", "jailbreak"],
 *         "thresholds": { "blockThreshold": 0.95 },
 *         "streamingMode": true
 *       }
 *     }
 *   ]
 * }
 * ```
 */
export function createExtensionPack(context: ExtensionPackContext): ExtensionPack {
  return createMLClassifierPack(context.options as MLClassifierPackOptions);
}
