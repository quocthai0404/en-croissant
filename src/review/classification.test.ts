import { describe, expect, test } from "vitest";
import { classifyMove, getMoverWinChanceLoss } from "./classification";

const score = (value: number) => ({ type: "cp" as const, value });
const base = {
  mover: "white" as const,
  san: "Nf3",
  scoreBefore: score(0),
  scoreAfter: score(0),
  depthBefore: 20,
  depthAfter: 20,
  bestAlternativeSan: "Nf3",
};

function cpForMoverLoss(percentagePoints: number): number {
  const winChance = 50 - percentagePoints;
  return Math.log(winChance / (100 - winChance)) / 0.00368208;
}

describe("V3 evidence-based move classification", () => {
  test.each([
    [0, "best"],
    [11, "best"],
    [12, "best"],
  ] as const)("classifies a top-PV move at %i cp as %s", (lossCp, expected) => {
    expect(classifyMove({ ...base, scoreAfter: score(-lossCp) }).classification).toBe(expected);
  });

  test("uses mover-relative scores for Black", () => {
    const loss = getMoverWinChanceLoss(score(0), score(60), "black");
    expect(loss).toBeGreaterThan(5);
    expect(classifyMove({ ...base, mover: "black", san: "...Nf6", bestAlternativeSan: "...d5", scoreAfter: score(60) }).classification).toBe("mistake");
  });

  test("requires exact opening membership and suppresses Book after a larger loss", () => {
    expect(classifyMove({ ...base, san: "e4", bestAlternativeSan: "d4", exactOpeningMatch: true }).classification).toBe("book");
    expect(classifyMove({ ...base, san: "e4", bestAlternativeSan: "d4", exactOpeningMatch: false }).classification).toBe("excellent");
    expect(classifyMove({ ...base, san: "e4", bestAlternativeSan: "d4", exactOpeningMatch: true, scoreAfter: score(cpForMoverLoss(3.5)) }).classification).not.toBe("book");
  });

  test("does not award positive labels below minimum depth", () => {
    expect(classifyMove({ ...base, depthBefore: 11, depthAfter: 20 }).classification).toBe("unclassified");
  });

  test("allows Brilliant only for a verified engine-best sacrifice", () => {
    expect(classifyMove({ ...base, verifiedSacrifice: true }).classification).toBe("brilliant");
    expect(classifyMove({ ...base, verifiedSacrifice: false }).classification).toBe("best");
  });

  test.each([
    [0.5, "excellent"],
    [2, "good"],
    [4, "inaccuracy"],
    [8, "mistake"],
    [15, "blunder"],
  ] as const)("classifies a non-best move from score evidence (%i percentage points)", (loss, expected) => {
    expect(classifyMove({ ...base, san: "h3", bestAlternativeSan: "Nf3", scoreAfter: score(cpForMoverLoss(loss)) }).classification).toBe(expected);
  });

  test.each([
    [1, "excellent"],
    [3, "good"],
    [5, "inaccuracy"],
    [10, "mistake"],
    [10.01, "blunder"],
  ] as const)("keeps the %i-point boundary in the %s band", (loss, expected) => {
    expect(classifyMove({ ...base, san: "h3", bestAlternativeSan: "Nf3", scoreAfter: score(cpForMoverLoss(loss)) }).classification).toBe(expected);
  });

  test("rejects missing or non-finite score evidence", () => {
    expect(classifyMove({ ...base, scoreAfter: null }).classification).toBe("unclassified");
    expect(classifyMove({ ...base, scoreAfter: score(Number.POSITIVE_INFINITY) }).classification).toBe("unclassified");
  });
});
