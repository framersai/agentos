/**
 * LLM routing barrel — model routers and policy-aware routing.
 *
 * @module core/llm/routing
 */

export type { IModelRouter, ModelRouteParams, ModelRouteResult } from './IModelRouter.js';
export { ModelRouter } from './ModelRouter.js';
export { PolicyAwareRouter, type PolicyOverrides } from './PolicyAwareRouter.js';
export {
  createUncensoredModelCatalog,
  type UncensoredModelCatalog,
  type CatalogEntry,
  type PolicyTier,
  type ContentIntent,
} from './UncensoredModelCatalog.js';
