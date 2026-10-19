import { describe, expect, test } from "vitest";
import type { ReviewEvidenceRecord } from "./types";
import { buildMoveCoachSummary, findReviewRecordAtPosition, getReviewRowScrollTop } from "./coach";

function record(overrides: Partial<ReviewEvidenceRecord> = {}): ReviewEvidenceRecord {
  return {
    moveId: "golden-game:46",
    mainlinePly: 46,
    position: Array.from({ length: 46 }, () => 0),
    san: "Nf6",
    playedMove: { from: "g8", to: "f6" },
    piece: "n",
    mover: "black",
    beforeScore: { value: { type: "cp", value: 30 }, wdl: null },
    afterScore: { value: { type: "cp", value: 15 }, wdl: null },
    beforeDepth: 20,
    afterDepth: 20,
    classification: "excellent",
    loss: 0.2,
    facts: [],
    ...overrides,
  };
}

describe("compact per-move coach summaries", () => {
  test("shows mover-colored piece, SAN, classification, phrase, and White-perspective evaluation", () => {
    expect(buildMoveCoachSummary(record())).toEqual({
      pieceGlyph: "♞",
      move: "Nf6",
      moveNumber: "23...",
      classification: "Excellent",
      phrase: "nước rất tốt",
      evaluation: "+0.15",
    });

    expect(buildMoveCoachSummary(record({ mover: "white", piece: "p", san: "e4" })).pieceGlyph).toBe("♙");
  });

  test("uses a clear neutral phrase when evidence cannot support a label", () => {
    expect(buildMoveCoachSummary(record({ classification: "unclassified" }))).toMatchObject({
      classification: "Unclassified",
      phrase: "chưa đủ dữ liệu để xếp loại",
    });
  });

  test("matches only the exact selected mainline position", () => {
    const selected = record();
    expect(findReviewRecordAtPosition([selected], [...selected.position])).toBe(selected);
    expect(findReviewRecordAtPosition([selected], [...selected.position, 1])).toBeUndefined();
    expect(findReviewRecordAtPosition([selected], selected.position.slice(1))).toBeUndefined();
  });

  test("keeps the active row visible by adjusting only the move-list viewport", () => {
    const viewport = { top: 100, bottom: 300 };
    expect(getReviewRowScrollTop(400, viewport, { top: 60, bottom: 90 })).toBe(360);
    expect(getReviewRowScrollTop(400, viewport, { top: 310, bottom: 350 })).toBe(450);
    expect(getReviewRowScrollTop(400, viewport, { top: 150, bottom: 190 })).toBe(400);
  });
});
