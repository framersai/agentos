/**
 * @fileoverview Translate {@link RagRetrievalScope} into vector-store
 * {@link MetadataFilter} entries. Lets the augmentor filter forbidden
 * context **before** retrieval rather than asking the model to ignore it.
 *
 * The well-known metadata keys read here are the same names the
 * augmentor copies from {@link RagDocumentInput} at ingest time:
 *
 *   tenantId, aclGroups, classification, status, effectiveDate, expiresAt
 *
 * Vector stores that index these natively can short-circuit; stores that
 * only support flat metadata still get the filter via the standard
 * `MetadataFieldCondition` operators.
 *
 * @module @framers/agentos/cognition/rag/scopeFilter
 */

import type { MetadataFilter, MetadataFieldCondition } from '../../core/vector-store/IVectorStore.js';
import type { RagRetrievalScope } from './IRetrievalAugmentor.js';

/**
 * Numeric trust ranking for the four sensitivity classifications.
 * Higher number = more sensitive. A principal with `maxClassification`
 * `internal` (ordinal 2) can see anything ≤ 2 (public, internal) but not
 * confidential (3) or restricted (4).
 */
const CLASSIFICATION_ORDINAL: Record<'public' | 'internal' | 'confidential' | 'restricted', number> = {
  public: 1,
  internal: 2,
  confidential: 3,
  restricted: 4,
};

/** Lowest ordinal ≤ max we should ALLOW into results. */
function allowedClassifications(
  max: 'public' | 'internal' | 'confidential' | 'restricted',
): Array<'public' | 'internal' | 'confidential' | 'restricted'> {
  const cap = CLASSIFICATION_ORDINAL[max];
  return (Object.keys(CLASSIFICATION_ORDINAL) as Array<keyof typeof CLASSIFICATION_ORDINAL>).filter(
    (k) => CLASSIFICATION_ORDINAL[k] <= cap,
  );
}

/**
 * Convert a {@link RagRetrievalScope} into a {@link MetadataFilter}. Returns
 * `undefined` when the scope adds no constraints (caller can skip the merge).
 *
 * Semantics:
 * - `tenantId`         → `{ tenantId: { $eq } }`
 * - `aclGroups`        → `{ aclGroups: { $in } }` (intersection: at least
 *                         one of the principal's groups must be in the
 *                         chunk's `aclGroups`)
 * - `maxClassification` → `{ classification: { $in: allowed } }`
 * - `status`           → `{ status: { $in } }` (default `['active']`)
 * - `now`              → `{ effectiveDate: { $lte: now }, expiresAt: { $gte: now } }`
 *                         When `expiresAt` is absent on a chunk we expect the
 *                         vector store to treat the field as "no upper bound";
 *                         stores that don't support optional ranges should
 *                         skip the lifetime filter and let callers post-filter.
 */
export function scopeToMetadataFilter(scope: RagRetrievalScope | undefined): MetadataFilter | undefined {
  if (!scope) return undefined;

  const filter: MetadataFilter = {};
  let added = false;

  if (scope.tenantId) {
    filter.tenantId = { $eq: scope.tenantId } satisfies MetadataFieldCondition;
    added = true;
  }

  if (scope.aclGroups && scope.aclGroups.length > 0) {
    filter.aclGroups = { $in: scope.aclGroups } satisfies MetadataFieldCondition;
    added = true;
  }

  if (scope.maxClassification) {
    filter.classification = {
      $in: allowedClassifications(scope.maxClassification),
    } satisfies MetadataFieldCondition;
    added = true;
  }

  const statusList = scope.status ?? ['active'];
  filter.status = { $in: statusList } satisfies MetadataFieldCondition;
  added = true;

  if (scope.now) {
    filter.effectiveDate = { $lte: scope.now } satisfies MetadataFieldCondition;
    filter.expiresAt = { $gte: scope.now } satisfies MetadataFieldCondition;
    added = true;
  }

  return added ? filter : undefined;
}

/**
 * Merge a caller-supplied {@link MetadataFilter} with the scope-derived
 * filter. Caller fields win on conflict (caller knows their domain best);
 * unfilled scope fields are added.
 */
export function mergeMetadataFilters(
  caller: MetadataFilter | undefined,
  scope: MetadataFilter | undefined,
): MetadataFilter | undefined {
  if (!caller) return scope;
  if (!scope) return caller;
  return { ...scope, ...caller };
}
