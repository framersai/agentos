/**
 * Cross-platform base64 helpers for memory import/export.
 *
 * These helpers avoid relying on Node's Buffer in browser builds while still
 * using it when available for performance.
 */
export declare function bytesToBase64(value: ArrayBuffer | ArrayBufferView | Uint8Array): string;
export declare function base64ToBytes(encoded: string): Uint8Array;
export declare function asBinaryBytes(value: unknown): Uint8Array | null;
//# sourceMappingURL=base64.d.ts.map