/**
 * @file MerkleTree.test.ts
 * @description Tests for Merkle root computation and inclusion proofs.
 */

import { describe, it, expect } from 'vitest';
import { MerkleTree } from '../crypto/MerkleTree.js';
import { HashChain } from '../crypto/HashChain.js';

describe('MerkleTree', () => {
  describe('computeRoot', () => {
    it('should compute root for a single leaf', () => {
      const root = MerkleTree.computeRoot(['abc']);
      expect(root).toBe('abc');
    });

    it('should compute root for two leaves', () => {
      const root = MerkleTree.computeRoot(['a', 'b']);
      const expected = HashChain.hash('a' + 'b');
      expect(root).toBe(expected);
    });

    it('should compute root for four leaves', () => {
      const leaves = ['a', 'b', 'c', 'd'];
      const root = MerkleTree.computeRoot(leaves);
      const ab = HashChain.hash('a' + 'b');
      const cd = HashChain.hash('c' + 'd');
      const expected = HashChain.hash(ab + cd);
      expect(root).toBe(expected);
    });

    it('should handle odd number of leaves by duplicating last', () => {
      const leaves = ['a', 'b', 'c'];
      const root = MerkleTree.computeRoot(leaves);
      const ab = HashChain.hash('a' + 'b');
      const cc = HashChain.hash('c' + 'c');
      const expected = HashChain.hash(ab + cc);
      expect(root).toBe(expected);
    });

    it('should return empty string for empty input', () => {
      const root = MerkleTree.computeRoot([]);
      expect(root).toBe('');
    });

    it('should produce deterministic results', () => {
      const leaves = ['x', 'y', 'z'];
      const root1 = MerkleTree.computeRoot(leaves);
      const root2 = MerkleTree.computeRoot(leaves);
      expect(root1).toBe(root2);
    });
  });

  describe('computeProof', () => {
    it('should generate inclusion proof for a leaf', () => {
      const leaves = ['a', 'b', 'c', 'd'];
      const proof = MerkleTree.computeProof(leaves, 0);
      expect(proof).toBeTruthy();
      expect(proof.leafHash).toBe('a');
      expect(proof.leafIndex).toBe(0);
      expect(proof.proof.length).toBeGreaterThan(0);
    });

    it('should throw for out-of-bounds index', () => {
      const leaves = ['a', 'b'];
      expect(() => MerkleTree.computeProof(leaves, 5)).toThrow();
    });

    it('should throw for negative index', () => {
      const leaves = ['a', 'b'];
      expect(() => MerkleTree.computeProof(leaves, -1)).toThrow();
    });
  });

  describe('verifyProof', () => {
    it('should verify a valid inclusion proof', () => {
      const leaves = ['a', 'b', 'c', 'd'];
      const proof = MerkleTree.computeProof(leaves, 2);

      const isValid = MerkleTree.verifyProof(proof);
      expect(isValid).toBe(true);
    });

    it('should verify proof for each leaf in the tree', () => {
      const leaves = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];

      for (let i = 0; i < leaves.length; i++) {
        const proof = MerkleTree.computeProof(leaves, i);
        expect(MerkleTree.verifyProof(proof)).toBe(true);
      }
    });

    it('should reject proof with tampered root', () => {
      const leaves = ['a', 'b', 'c', 'd'];
      const proof = MerkleTree.computeProof(leaves, 0);
      proof.root = 'wrong_root';

      const isValid = MerkleTree.verifyProof(proof);
      expect(isValid).toBe(false);
    });

    it('should reject tampered proof', () => {
      const leaves = ['a', 'b', 'c', 'd'];
      const proof = MerkleTree.computeProof(leaves, 0);
      proof.proof[0].hash = 'tampered';

      const isValid = MerkleTree.verifyProof(proof);
      expect(isValid).toBe(false);
    });
  });
});
