export interface RetrievalConfidenceInput {
  adaptive: boolean;
  minScore: number;
}

export interface RetrievalConfidenceSummary {
  topScore: number;
  secondScore: number;
  usefulHitCount: number;
  scoreGap: number;
  suppressResults: boolean;
  shouldEscalate: boolean;
  reason: 'ok' | 'no_hits' | 'weak_hits' | 'single_weak_hit';
}

type ScoredLike = { retrievalScore?: number; relevanceScore?: number };

function comparableScore(item: ScoredLike): number {
  return item.retrievalScore ?? item.relevanceScore ?? 0;
}

export function evaluateRetrievalConfidence(
  items: ScoredLike[],
  input: RetrievalConfidenceInput,
): RetrievalConfidenceSummary {
  const scores = [...items].map(comparableScore).sort((a, b) => b - a);
  const topScore = scores[0] ?? 0;
  const secondScore = scores[1] ?? 0;
  const usefulHitCount = scores.filter((score) => score >= input.minScore).length;
  const scoreGap = topScore - secondScore;

  if (scores.length === 0) {
    return {
      topScore,
      secondScore,
      usefulHitCount,
      scoreGap,
      suppressResults: true,
      shouldEscalate: input.adaptive,
      reason: 'no_hits',
    };
  }

  if (topScore < input.minScore) {
    return {
      topScore,
      secondScore,
      usefulHitCount,
      scoreGap,
      suppressResults: true,
      shouldEscalate: input.adaptive,
      reason: 'weak_hits',
    };
  }

  if (usefulHitCount === 1 && scoreGap < 0.05) {
    return {
      topScore,
      secondScore,
      usefulHitCount,
      scoreGap,
      suppressResults: false,
      shouldEscalate: input.adaptive,
      reason: 'single_weak_hit',
    };
  }

  return {
    topScore,
    secondScore,
    usefulHitCount,
    scoreGap,
    suppressResults: false,
    shouldEscalate: false,
    reason: 'ok',
  };
}
