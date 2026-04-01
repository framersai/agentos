/**
 * @file MerkleTree.ts
 * @description Merkle tree computation for anchoring provenance events.
 * Computes a root hash from a list of leaf hashes.
 *
 * @module AgentOS/Provenance/Crypto
 */
import { createHash } from 'node:crypto';
// =============================================================================
// MerkleTree
// =============================================================================
export class MerkleTree {
    /**
     * Compute the Merkle root of a list of leaf hashes.
     * If the number of leaves is odd, the last leaf is duplicated.
     * Returns empty string for empty input.
     */
    static computeRoot(leaves, algorithm = 'sha256') {
        if (leaves.length === 0)
            return '';
        if (leaves.length === 1)
            return leaves[0];
        let currentLevel = [...leaves];
        while (currentLevel.length > 1) {
            const nextLevel = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                // If odd number of nodes, duplicate the last one
                const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : currentLevel[i];
                const combined = left + right;
                const parentHash = createHash(algorithm).update(combined, 'utf-8').digest('hex');
                nextLevel.push(parentHash);
            }
            currentLevel = nextLevel;
        }
        return currentLevel[0];
    }
    /**
     * Compute a Merkle inclusion proof for a leaf at a given index.
     * Returns the sibling hashes needed to reconstruct the root.
     */
    static computeProof(leaves, leafIndex, algorithm = 'sha256') {
        if (leafIndex < 0 || leafIndex >= leaves.length) {
            throw new Error(`MerkleTree: leafIndex ${leafIndex} out of range [0, ${leaves.length})`);
        }
        const proof = [];
        let currentLevel = [...leaves];
        let currentIndex = leafIndex;
        while (currentLevel.length > 1) {
            const nextLevel = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : currentLevel[i];
                if (i === currentIndex || i + 1 === currentIndex) {
                    const siblingHash = i === currentIndex ? right : left;
                    const position = i === currentIndex ? 'right' : 'left';
                    proof.push({ hash: siblingHash, position });
                }
                const combined = left + right;
                nextLevel.push(createHash(algorithm).update(combined, 'utf-8').digest('hex'));
            }
            currentIndex = Math.floor(currentIndex / 2);
            currentLevel = nextLevel;
        }
        return {
            leafHash: leaves[leafIndex],
            leafIndex,
            proof,
            root: currentLevel[0],
        };
    }
    /**
     * Verify a Merkle inclusion proof.
     */
    static verifyProof(proof, algorithm = 'sha256') {
        let currentHash = proof.leafHash;
        for (const step of proof.proof) {
            const combined = step.position === 'right'
                ? currentHash + step.hash
                : step.hash + currentHash;
            currentHash = createHash(algorithm).update(combined, 'utf-8').digest('hex');
        }
        return currentHash === proof.root;
    }
}
//# sourceMappingURL=MerkleTree.js.map