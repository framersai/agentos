/**
 * Buffers streaming TEXT_DELTA chunks and flushes at sentence boundaries.
 * Includes the previous sentence as overlap context for safety evaluation.
 */
export class SentenceBoundaryBuffer {
  private buffer = '';
  private previousSentence = '';

  /** Push a chunk. Returns evaluation payload if sentence boundary detected, null otherwise. */
  push(chunk: string): string | null {
    this.buffer += chunk;
    const idx = this.findBoundary(this.buffer);
    if (idx === -1) return null;
    const sentence = this.buffer.slice(0, idx + 1).trim();
    this.buffer = this.buffer.slice(idx + 1);
    const payload = this.previousSentence
      ? `${this.previousSentence} ${sentence}`
      : sentence;
    this.previousSentence = sentence;
    return payload;
  }

  /** Flush remaining buffer content (call on stream end). */
  flush(): string | null {
    if (!this.buffer.trim()) return null;
    const result = this.previousSentence
      ? `${this.previousSentence} ${this.buffer.trim()}`
      : this.buffer.trim();
    this.buffer = '';
    this.previousSentence = '';
    return result;
  }

  /** Reset all state. */
  reset(): void {
    this.buffer = '';
    this.previousSentence = '';
  }

  private findBoundary(text: string): number {
    for (let i = text.length - 1; i >= 0; i--) {
      if ('.?!\n'.includes(text[i])) return i;
    }
    return -1;
  }
}
