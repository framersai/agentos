/**
 * Generate a RFC4122 version 4 UUID using the best source of randomness
 * available in the current runtime (Node, browser, workers, etc.).
 */
export declare function generateUUID(): string;
/**
 * Backwards compatible aliases.
 */
export declare const uuidv4: typeof generateUUID;
export declare const generateUniqueId: typeof generateUUID;
//# sourceMappingURL=uuid.d.ts.map