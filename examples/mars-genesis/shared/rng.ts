/**
 * Mulberry32 — fast 32-bit seeded PRNG.
 * Deterministic: same seed always produces same sequence.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Returns true with the given probability (0-1). */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Picks a random element from an array. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /** Derives a child RNG for a specific turn (deterministic sub-stream). */
  turnSeed(turn: number): SeededRng {
    return new SeededRng(this.state ^ (turn * 2654435761));
  }
}
