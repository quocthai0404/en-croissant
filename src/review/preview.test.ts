import { Chess } from "chess.js";
import { describe, expect, test } from "vitest";
import {
  buildLegalPreviewLine,
  choosePreferredPreviewLine,
  getPreviewCurrentStep,
  getPreviewFen,
  getPreviewStepOverlay,
  isReviewPreviewCurrent,
  updateReviewPreviewLine,
  updateReviewPreviewPlayback,
} from "./preview";
import type { ReviewPv } from "./types";

const pv = (san: string[], uci = san.map(() => "")): ReviewPv => ({
  san,
  uci,
  depth: 22,
  score: { value: { type: "cp", value: 31 }, wdl: null },
});

describe("temporary engine-line playback data", () => {
  test("replays legal UCI/SAN and produces board positions without touching source state", () => {
    const original = new Chess().fen();
    const line = buildLegalPreviewLine(original, pv(["e4", "e5", "Nf3"], ["e2e4", "e7e5", "g1f3"]));

    expect(line?.steps.map((step) => step.san)).toEqual(["e4", "e5", "Nf3"]);
    expect(line?.steps.map((step) => step.fen)).toHaveLength(3);
    expect(new Chess().fen()).toBe(original);
  });

  test("keeps only the legal prefix for an incomplete or illegal PV", () => {
    const line = buildLegalPreviewLine(new Chess().fen(), pv(["e4", "not a move", "e5"], ["e2e4", "a1a8", "e7e5"]));
    expect(line?.steps.map((step) => step.san)).toEqual(["e4"]);
  });

  test("uses the selected line start and step without changing the mainline position", () => {
    const mainlineFen = new Chess().fen();
    const line = buildLegalPreviewLine(mainlineFen, pv(["e4", "e5"], ["e2e4", "e7e5"]))!;
    const preview = {
      activeTab: "tab",
      gameId: "game",
      rootFen: mainlineFen,
      mainlineIdentity: "d2d4",
      sourcePosition: [0],
      moveId: "game:1",
      lineType: "alternative" as const,
      baseFen: mainlineFen,
      lines: { alternative: line },
      stepIndex: 1,
      playing: false,
      factsOverlay: [],
    };

    expect(getPreviewFen(preview)).toBe(line.steps[0]?.fen);
    expect(getPreviewCurrentStep(preview)?.san).toBe("e4");
    expect(getPreviewStepOverlay(getPreviewCurrentStep(preview))).toEqual([
      { orig: "e2", dest: "e4", brush: "preview" },
    ]);
    expect(getPreviewFen({ ...preview, stepIndex: 0 })).toBe(mainlineFen);
  });

  test("handles empty and invalid starting positions safely", () => {
    expect(buildLegalPreviewLine("not a fen", pv(["e4"]))).toBeUndefined();
    expect(buildLegalPreviewLine(new Chess().fen(), pv([]))?.steps).toEqual([]);
  });

  test("prefers a pre-move alternative for mistakes and post-move continuation otherwise", () => {
    const line = buildLegalPreviewLine(new Chess().fen(), pv(["e4"], ["e2e4"]))!;
    expect(choosePreferredPreviewLine("mistake", line, line)).toBe("alternative");
    expect(choosePreferredPreviewLine("inaccuracy", line, line)).toBe("alternative");
    expect(choosePreferredPreviewLine("good", line, line)).toBe("continuation");
    expect(choosePreferredPreviewLine("blunder", undefined, line)).toBe("continuation");
    expect(choosePreferredPreviewLine("best", undefined, undefined)).toBeNull();
  });

  test("supports repeatable play, pause, step, replay, and line-switch state changes", () => {
    const fen = new Chess().fen();
    const line = buildLegalPreviewLine(fen, pv(["e4", "e5"], ["e2e4", "e7e5"]))!;
    const initial = {
      activeTab: "tab",
      gameId: "game",
      rootFen: fen,
      mainlineIdentity: "e4",
      sourcePosition: [0],
      moveId: "game:1",
      lineType: "alternative" as const,
      baseFen: fen,
      lines: { alternative: line, continuation: line },
      stepIndex: 0,
      playing: false,
      factsOverlay: [],
    };

    const playing = updateReviewPreviewPlayback(initial, "toggle");
    expect(playing.playing).toBe(true);
    const paused = updateReviewPreviewPlayback(playing, "toggle");
    expect(paused.playing).toBe(false);
    const stepped = updateReviewPreviewPlayback(initial, "next");
    expect(stepped.stepIndex).toBe(1);
    expect(updateReviewPreviewPlayback(stepped, "previous").stepIndex).toBe(0);
    expect(updateReviewPreviewPlayback(stepped, "replay").stepIndex).toBe(0);
    expect(updateReviewPreviewLine(stepped, "continuation")).toMatchObject({
      lineType: "continuation",
      stepIndex: 0,
      playing: false,
    });
    const finished = { ...initial, stepIndex: 2 };
    expect(updateReviewPreviewPlayback(finished, "toggle")).toMatchObject({ stepIndex: 0, playing: true });
  });

  test("invalidates preview when normal mainline navigation or game context changes", () => {
    const fen = new Chess().fen();
    const preview = {
      activeTab: "tab",
      gameId: "game",
      rootFen: fen,
      mainlineIdentity: "e4",
      sourcePosition: [0],
      moveId: "game:1",
      lineType: null,
      baseFen: fen,
      lines: {},
      stepIndex: 0,
      playing: false,
      factsOverlay: [],
    };
    const current = {
      activeTab: "tab",
      gameId: "game",
      rootFen: fen,
      mainlineIdentity: "e4",
      position: [0],
      availableMoveIds: ["game:1"],
    };
    expect(isReviewPreviewCurrent(preview, current)).toBe(true);
    expect(isReviewPreviewCurrent(preview, { ...current, position: [0, 0] })).toBe(false);
    expect(isReviewPreviewCurrent(preview, { ...current, activeTab: "other" })).toBe(false);
    expect(isReviewPreviewCurrent(preview, { ...current, gameId: "other-game" })).toBe(false);
    expect(isReviewPreviewCurrent(preview, { ...current, availableMoveIds: [] })).toBe(false);
  });
});
