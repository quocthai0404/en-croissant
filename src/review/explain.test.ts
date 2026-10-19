import { describe, expect, test } from "vitest";
import type { ReviewEvidenceRecord } from "./types";
import { buildExplainPresentation } from "./explain";

const cp = (value: number) => ({ value: { type: "cp" as const, value }, wdl: null });

function record(overrides: Partial<ReviewEvidenceRecord> = {}): ReviewEvidenceRecord {
  return {
    moveId: "game:45",
    mainlinePly: 45,
    position: Array.from({ length: 45 }, () => 0),
    san: "c4",
    playedMove: { from: "c3", to: "c4" },
    piece: "p",
    mover: "white",
    beforeScore: cp(0),
    afterScore: cp(-80),
    beforeDepth: 20,
    afterDepth: 20,
    classification: "mistake",
    loss: 7.3,
    facts: [],
    bestAlternativeBefore: {
      san: ["d4", "Nf6", "c4"],
      uci: ["d2d4", "g8f6", "c2c4"],
      depth: 20,
      score: cp(0),
    },
    ...overrides,
  };
}

describe("local Explain quality", () => {
  test("gives a useful engine comparison for a quiet move without inventing a cause", () => {
    const result = buildExplainPresentation(record(), [], "neutral");
    expect(result.paragraphs.join(" ")).toContain("Máy ưu tiên d4 thay vì c4");
    expect(result.paragraphs.join(" ")).toContain("7.3 điểm phần trăm");
    expect(result.paragraphs.join(" ")).toContain("d4 Nf6 c4");
    expect(result.paragraphs.join(" ")).not.toContain("mất hậu");
    expect(result.boardPosition).toBe("before");
    expect(result.overlay[0]).toMatchObject({ orig: "d2", dest: "d4" });
  });

  test("uses exact Book evidence as opening context without suppressing the engine comparison", () => {
    const result = buildExplainPresentation(record({
      classification: "book",
      opening: { eco: "C20", name: "King's Pawn Game" },
    }), [], "neutral");

    expect(result.paragraphs[0]).toContain("King's Pawn Game (C20)");
    expect(result.paragraphs.join(" ")).toContain("Máy ưu tiên d4 thay vì c4");
  });

  test("connects a realized capture to its earlier cause without repeating the full explanation", () => {
    const cause = record({ san: "c4", mainlinePly: 45, position: Array(45).fill(0) });
    const exploitation = record({
      san: "Bxb2",
      piece: "b",
      mover: "black",
      mainlinePly: 46,
      position: Array(46).fill(0),
      event: { id: "event-1", role: "exploitation", relatedPly: 45, result: "actual" },
      facts: [{
        id: "46:capture",
        code: "CAPTURED_PIECE",
        subjectSide: "black",
        actor: { side: "black", type: "b", square: "g7" },
        target: { side: "white", type: "q", square: "b2" },
        confidence: "verified",
        source: "adapter",
      }],
    });
    const result = buildExplainPresentation(exploitation, [cause, exploitation], "white");
    expect(result.paragraphs[0]).toContain("23...Bxb2 bắt hậu của bạn tại b2 và tận dụng sơ hở do 23.c4");
    expect(result.paragraphs.join(" ")).not.toContain("đường tấn công g7");
    expect(result.overlay.some((shape) => shape.orig === "g7" && shape.dest === "b2")).toBe(true);
  });

  test("uses perspective for verified geometry and refuses to call a legal capture a won piece", () => {
    const position = record({
      facts: [{
        id: "45:opened-line",
        code: "OPENED_ATTACK_LINE",
        subjectSide: "white",
        actor: { side: "black", type: "b", square: "g7" },
        blocker: { side: "white", type: "p", square: "c3" },
        target: { side: "white", type: "q", square: "b2" },
        squares: ["g7", "f6", "e5", "d4", "c3", "b2"],
        evidenceMoves: ["Bxb2"],
        confidence: "verified",
        source: "adapter",
      }, {
        id: "45:legal-capture",
        code: "LEGAL_CAPTURE_AVAILABLE",
        subjectSide: "white",
        actor: { side: "black", type: "b", square: "g7" },
        target: { side: "white", type: "q", square: "b2" },
        evidenceMoves: ["Bxb2"],
        confidence: "verified",
        source: "adapter",
      }],
    });
    const white = buildExplainPresentation(position, [], "white");
    const black = buildExplainPresentation(position, [], "black");
    expect(white.paragraphs[0]).toContain("Bạn đi c4");
    expect(black.paragraphs[0]).toContain("Đối thủ đi c4");
    expect(white.paragraphs.join(" ")).toContain("chưa chứng minh quân sẽ mất");
    expect(white.paragraphs.join(" ")).not.toContain("đã thắng hậu");
    expect(white.overlay.some((shape) => shape.orig === "g7" && shape.dest === "b2")).toBe(true);
  });
});
