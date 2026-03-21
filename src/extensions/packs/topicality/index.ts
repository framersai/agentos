/**
 * @fileoverview Pack factory for the Topicality Guardrail Extension Pack.
 *
 * Exports the main `createTopicalityPack()` factory that assembles the
 * {@link TopicalityGuardrail} and the {@link CheckTopicTool} into a single
 * {@link ExtensionPack} ready for registration with the AgentOS extension
 * manager.
 *
 * Also exports a `createExtensionPack()` bridge function that conforms to
 * the AgentOS manifest factory convention, delegating to
 * `createTopicalityPack()` with options extracted from the
 * {@link ExtensionPackContext}.
 *
 * ### Default behaviour (zero-config)
 * When called without arguments, no topics are configured so the guardrail
 * and tool are effectively no-ops.  Callers should provide at least
 * `allowedTopics` or `forbiddenTopics` for meaningful enforcement.
 *
 * ### Activation lifecycle
 * Components are built eagerly at pack creation time for direct programmatic
 * use.  When the extension manager activates the pack, `onActivate` rebuilds
 * all components with the manager's shared service registry so heavyweight
 * resources (embedding models) are shared across the agent.
 *
 * @example
 * ```typescript
 * import { createTopicalityPack, TOPIC_PRESETS } from './topicality';
 *
 * const pack = createTopicalityPack({
 *   allowedTopics: TOPIC_PRESETS.customerSupport,
 *   forbiddenTopics: TOPIC_PRESETS.commonUnsafe,
 * });
 * ```
 *
 * @module agentos/extensions/packs/topicality
 */

import type { ISharedServiceRegistry } from '../../ISharedServiceRegistry';
import { SharedServiceRegistry } from '../../SharedServiceRegistry';
import type { ExtensionPack, ExtensionPackContext } from '../../manifest';
import type { ExtensionDescriptor, ExtensionLifecycleContext } from '../../types';
import { EXTENSION_KIND_GUARDRAIL, EXTENSION_KIND_TOOL } from '../../types';
import type { TopicalityPackOptions } from './types';
import { TopicalityGuardrail } from './TopicalityGuardrail';
import { CheckTopicTool } from './tools/CheckTopicTool';

// ---------------------------------------------------------------------------
// Re-exports — allow single-import for consumers
// ---------------------------------------------------------------------------

/**
 * Re-export all types from the topicality type definitions so consumers
 * can import everything from a single entry point:
 * ```ts
 * import { createTopicalityPack, TOPIC_PRESETS } from './topicality';
 * ```
 */
export * from './types';

// ---------------------------------------------------------------------------
// Pack factory
// ---------------------------------------------------------------------------

/**
 * Create an {@link ExtensionPack} that bundles:
 *  - The {@link TopicalityGuardrail} guardrail (evaluates input & output
 *    against allowed/forbidden topics and drift detection).
 *  - The {@link CheckTopicTool} `check_topic` tool (on-demand topic analysis).
 *
 * @param options - Optional pack-level configuration.  All properties have
 *                  sensible defaults; see {@link TopicalityPackOptions}.
 * @returns A fully-configured {@link ExtensionPack} with one guardrail
 *          descriptor and one tool descriptor.
 */
export function createTopicalityPack(options?: TopicalityPackOptions): ExtensionPack {
  /**
   * Resolved options — default to empty object so every sub-check can
   * safely use `opts.foo` without null-guarding the whole `options` reference.
   */
  const opts: TopicalityPackOptions = options ?? {};

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
   * The guardrail that evaluates user input and/or agent output against
   * configured allowed and forbidden topic sets.
   */
  let guardrail: TopicalityGuardrail;

  /**
   * The on-demand topic checking tool exposed to agents and workflows.
   */
  let tool: CheckTopicTool;

  // -------------------------------------------------------------------------
  // Embedding function resolution
  // -------------------------------------------------------------------------

  /**
   * Resolves the embedding function to use for topic matching.
   *
   * Priority:
   * 1. Explicit `opts.embeddingFn` provided by the caller.
   * 2. Fallback to the shared service registry's EmbeddingManager.
   *
   * @returns An async embedding function.
   */
  function resolveEmbeddingFn(): (texts: string[]) => Promise<number[][]> {
    if (opts.embeddingFn) {
      return opts.embeddingFn;
    }

    // Fallback: request an EmbeddingManager from the shared service registry
    // at call time (lazy resolution).
    return async (texts: string[]): Promise<number[][]> => {
      const em = await state.services.getOrCreate<{
        generateEmbeddings: (texts: string[]) => Promise<number[][]>;
      }>(
        'agentos:topicality:embedding-manager',
        async () => {
          throw new Error(
            'EmbeddingManager not available in shared service registry. ' +
              'Provide an explicit embeddingFn in TopicalityPackOptions or ' +
              'register an EmbeddingManager before activating the topicality pack.',
          );
        },
      );
      return em.generateEmbeddings(texts);
    };
  }

  // -------------------------------------------------------------------------
  // buildComponents
  // -------------------------------------------------------------------------

  /**
   * (Re)construct all pack components using the current `state.services`.
   *
   * Called once at pack creation for direct programmatic use, and again
   * during `onActivate` to upgrade to the extension manager's shared
   * service registry.
   */
  function buildComponents(): void {
    const embeddingFn = resolveEmbeddingFn();

    // Resolve thresholds with defaults.
    const allowedThreshold = opts.allowedThreshold ?? 0.35;
    const forbiddenThreshold = opts.forbiddenThreshold ?? 0.65;

    // ------------------------------------------------------------------
    // 1. Build the guardrail.
    // ------------------------------------------------------------------
    guardrail = new TopicalityGuardrail(state.services, opts, embeddingFn);

    // ------------------------------------------------------------------
    // 2. Build the on-demand topic checking tool.
    //    The tool starts with null indices — the guardrail builds them
    //    lazily, and the tool shares the same embeddingFn so it can
    //    operate independently.
    // ------------------------------------------------------------------
    tool = new CheckTopicTool(
      null, // allowedIndex — will be null until lazy build
      null, // forbiddenIndex — will be null until lazy build
      embeddingFn,
      allowedThreshold,
      forbiddenThreshold,
    );

  }

  // Initial build — makes the pack usable immediately without activation.
  buildComponents();

  // -------------------------------------------------------------------------
  // ExtensionPack shape
  // -------------------------------------------------------------------------

  return {
    /** Canonical pack name used in manifests and logs. */
    name: 'topicality',

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
           * Priority 3 places this guardrail early in the pipeline so
           * topic enforcement happens before most other guardrails.
           */
          id: 'topicality-guardrail',
          kind: EXTENSION_KIND_GUARDRAIL,
          priority: 3,
          payload: guardrail,
        },
        {
          /**
           * On-demand topic checking tool descriptor.
           *
           * Priority 0 uses the default ordering — tools are typically
           * ordered by name rather than priority.
           */
          id: 'check_topic',
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
     * shared instance (so embedding models are shared across all
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
     * Clears drift tracker session state to release memory.
     */
    onDeactivate: async (): Promise<void> => {
      guardrail.clearSessionState();
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
 * and delegates to {@link createTopicalityPack}.
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
 *       "module": "./topicality",
 *       "options": {
 *         "allowedTopics": [...],
 *         "forbiddenTopics": [...],
 *         "allowedThreshold": 0.4
 *       }
 *     }
 *   ]
 * }
 * ```
 */
export function createExtensionPack(context: ExtensionPackContext): ExtensionPack {
  return createTopicalityPack(context.options as TopicalityPackOptions);
}
