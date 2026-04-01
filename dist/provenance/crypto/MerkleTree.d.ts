/**
 * @file MerkleTree.ts
 * @description Merkle tree computation for anchoring provenance events.
 * Computes a root hash from a list of leaf hashes.
 *
 * @module AgentOS/Provenance/Crypto
 */
export declare class MerkleTree {
    /**
     * Compute the Merkle root of a list of leaf hashes.
     * If the number of leaves is odd, the last leaf is duplicated.
     * Returns empty string for empty input.
     */
    static computeRoot(leaves: string[], algorithm?: string): string;
    /**
     * Compute a Merkle inclusion proof for a leaf at a given index.
     * Returns the sibling hashes needed to reconstruct the root.
     */
    static computeProof(leaves: string[], leafIndex: number, algorithm?: string): MerkleProof;
    /**
     * Verify a Merkle inclusion proof.
     */
    static verifyProof(proof: MerkleProof, algorithm?: string): boolean;
}
export interface MerkleProofStep {
    /** Sibling hash at this level. */
    hash: string;
    /** Position of the sibling relative to the current node. */
    position: 'left' | 'right';
}
export interface MerkleProof {
    /** Hash of the leaf being proved. */
    leafHash: string;
    /** Index of the leaf in the original list. */
    leafIndex: number;
    /** Ordered sibling hashes for reconstruction. */
    proof: MerkleProofStep[];
    /** Expected Merkle root. */
    root: string;
}
//# sourceMappingURL=MerkleTree.d.ts.map