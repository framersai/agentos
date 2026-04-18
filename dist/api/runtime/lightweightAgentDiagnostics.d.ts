import type { BaseAgentConfig } from '../types.js';
import { type CapabilityKey } from './capabilityContract.js';
export declare function getDeferredLightweightAgentCapabilities(config: Partial<BaseAgentConfig>): CapabilityKey[];
export declare function warnOnDeferredLightweightAgentCapabilities(config: Partial<BaseAgentConfig>, warn?: (message: string) => void): CapabilityKey[];
//# sourceMappingURL=lightweightAgentDiagnostics.d.ts.map