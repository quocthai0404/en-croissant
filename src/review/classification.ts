import type { ScoreValue } from "@/bindings";
import type { Side } from "@/commentary/types";
import { getWinChance, normalizeScore } from "@/utils/score";

export type ReviewClassification =
  | "book"
  | "brilliant"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder"
  | "unclassified";

export interface ClassificationInput {
  mover: Side;
  san: string;
  scoreBefore: ScoreValue | null | undefined;
  scoreAfter: ScoreValue | null | undefined;
  depthBefore: number | null | undefined;
  depthAfter: number | null | undefined;
  bestAlternativeSan: string | null | undefined;
  exactOpeningMatch?: boolean;
  verifiedSacrifice?: boolean;
}

export interface ClassificationResult {
  classification: ReviewClassification;
  /** Win-chance percentage points lost from the mover's perspective. */
  loss: number | null;
  reason: "insufficient-evidence" | "opening-membership" | "best-line" | "score-loss";
}

/**
 * Internal, conservative calibration for V3. This is not intended to reproduce
 * Chess.com's proprietary classifier. Score changes are win-chance percentage points.
 */
export const REVIEW_CLASSIFICATION_THRESHOLDS = {
  bookMaxLoss: 3,
  excellentMaxLoss: 1,
  goodMaxLoss: 3,
  inaccuracyMaxLoss: 5,
  mistakeMaxLoss: 10,
  positiveMinDepth: 12,
  negativeMinDepth: 10,
} as const;

const THRESHOLD_EPSILON = 1e-6;

function atMost(value: number, threshold: number): boolean {
  return value <= threshold + THRESHOLD_EPSILON;
}

export function getMoverWinChanceLoss(
  before: ScoreValue | null | undefined,
  after: ScoreValue | null | undefined,
  mover: Side,
): number | null {
  if (
    !before ||
    !after ||
    (before.type !== "cp" && before.type !== "mate") ||
    (after.type !== "cp" && after.type !== "mate") ||
    !Number.isFinite(before.value) ||
    !Number.isFinite(after.value)
  ) {
    return null;
  }
  const perspective = mover === "white" ? "white" : "black";
  const beforeChance = getWinChance(normalizeScore(before, perspective));
  const afterChance = getWinChance(normalizeScore(after, perspective));
  const loss = beforeChance - afterChance;
  return Number.isFinite(loss) ? Math.max(0, loss) : null;
}

export function classifyMove(input: ClassificationInput): ClassificationResult {
  const loss = getMoverWinChanceLoss(input.scoreBefore, input.scoreAfter, input.mover);
  const depths = [input.depthBefore, input.depthAfter];
  if (
    loss === null ||
    depths.some((depth) => depth === null || depth === undefined || !Number.isFinite(depth))
  ) {
    return { classification: "unclassified", loss, reason: "insufficient-evidence" };
  }

  const depth = Math.min(...(depths as number[]));
  if (depth < REVIEW_CLASSIFICATION_THRESHOLDS.negativeMinDepth) {
    return { classification: "unclassified", loss, reason: "insufficient-evidence" };
  }
  if (
    input.exactOpeningMatch &&
    depth >= REVIEW_CLASSIFICATION_THRESHOLDS.positiveMinDepth &&
    atMost(loss, REVIEW_CLASSIFICATION_THRESHOLDS.bookMaxLoss)
  ) {
    return { classification: "book", loss, reason: "opening-membership" };
  }

  const isBest = Boolean(input.bestAlternativeSan && input.san === input.bestAlternativeSan);
  if (
    isBest &&
    input.verifiedSacrifice &&
    depth >= REVIEW_CLASSIFICATION_THRESHOLDS.positiveMinDepth &&
    atMost(loss, REVIEW_CLASSIFICATION_THRESHOLDS.excellentMaxLoss)
  ) {
    return { classification: "brilliant", loss, reason: "best-line" };
  }

  if (depth >= REVIEW_CLASSIFICATION_THRESHOLDS.positiveMinDepth && isBest) {
    return { classification: "best", loss, reason: "best-line" };
  }
  if (
    depth < REVIEW_CLASSIFICATION_THRESHOLDS.positiveMinDepth &&
    atMost(loss, REVIEW_CLASSIFICATION_THRESHOLDS.goodMaxLoss)
  ) {
    return { classification: "unclassified", loss, reason: "insufficient-evidence" };
  }
  if (depth >= REVIEW_CLASSIFICATION_THRESHOLDS.positiveMinDepth && atMost(loss, REVIEW_CLASSIFICATION_THRESHOLDS.excellentMaxLoss)) {
    return { classification: "excellent", loss, reason: "score-loss" };
  }
  if (depth >= REVIEW_CLASSIFICATION_THRESHOLDS.positiveMinDepth && atMost(loss, REVIEW_CLASSIFICATION_THRESHOLDS.goodMaxLoss)) {
    return { classification: "good", loss, reason: "score-loss" };
  }
  if (atMost(loss, REVIEW_CLASSIFICATION_THRESHOLDS.inaccuracyMaxLoss)) {
    return { classification: "inaccuracy", loss, reason: "score-loss" };
  }
  if (atMost(loss, REVIEW_CLASSIFICATION_THRESHOLDS.mistakeMaxLoss)) {
    return { classification: "mistake", loss, reason: "score-loss" };
  }
  return { classification: "blunder", loss, reason: "score-loss" };
}

export function classificationLabel(classification: ReviewClassification): string {
  const labels: Record<ReviewClassification, string> = {
    book: "Book",
    brilliant: "Brilliant",
    best: "Best",
    excellent: "Excellent",
    good: "Good",
    inaccuracy: "Inaccuracy",
    mistake: "Mistake",
    blunder: "Blunder",
    unclassified: "Unclassified",
  };
  return labels[classification];
}

export function classificationGlyph(classification: ReviewClassification): string {
  const glyphs: Record<ReviewClassification, string> = {
    book: "📖",
    brilliant: "!!",
    best: "★",
    excellent: "✓",
    good: "•",
    inaccuracy: "?!",
    mistake: "?",
    blunder: "??",
    unclassified: "·",
  };
  return glyphs[classification];
}
