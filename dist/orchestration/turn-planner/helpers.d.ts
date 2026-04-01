import { CostAggregator } from '../../cognitive_substrate/IGMI';
import type { IPersonaDefinition } from '../../cognitive_substrate/personas/IPersonaDefinition';
/**
 * Normalises undefined cost fields so downstream consumers always receive a fully shaped usage object.
 */
export declare const normalizeUsage: (usage?: CostAggregator) => CostAggregator | undefined;
/**
 * Produces a lightweight persona snapshot suitable for metadata streaming.
 * Falls back to label/name display hints if the persona definition omits them.
 */
export declare const snapshotPersonaDetails: (persona?: IPersonaDefinition) => Partial<IPersonaDefinition> | undefined;
//# sourceMappingURL=helpers.d.ts.map