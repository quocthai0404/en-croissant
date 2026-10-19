import { Chess } from "chess.js";
import { parseUci } from "chessops";
import { describe, expect, test } from "vitest";
import type { MoveAnalysis } from "@/bindings";
import { createTreeStore } from "@/state/store/tree";
import { defaultTree, type TreeNode } from "@/utils/treeReducer";
import { buildReviewEvidence, isReviewEvidenceCurrent } from "./evidence";

function makeRoot(): TreeNode {
  const chess = new Chess();
  const move = chess.move("e4");
  const tree = defaultTree();
  tree.root.children = [{
    fen: move.after,
    move: parseUci("e2e4")!,
    san: move.san,
    children: [],
    score: null,
    depth: null,
    halfMoves: 1,
    shapes: [],
    annotations: [],
    comment: "",
  }];
  return tree.root;
}

function analysis(pv: string[], score: number): MoveAnalysis {
  return {
    best: [{
      nodes: 2000,
      depth: 20,
      score: { value: { type: "cp", value: score }, wdl: null },
      uciMoves: Array(10).fill("e2e4"),
      sanMoves: pv,
      multipv: 1,
      nps: 50_000,
    }],
    novelty: false,
    is_sacrifice: false,
  };
}

describe("session-local V3 review evidence", () => {
  test("stores exact Book membership and truncates engine PVs", () => {
    const root = makeRoot();
    const evidence = buildReviewEvidence(root, "stable-game", [
      analysis(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7"], 20),
      analysis(["d5", "exd5", "Qxd5"], 20),
    ], [{ eco: "C20", name: "King's Pawn Game" }]);

    expect(evidence.schemaVersion).toBe(1);
    expect(evidence.records).toHaveLength(1);
    expect(evidence.records[0]).toMatchObject({ san: "e4", piece: "p", mover: "white", classification: "book" });
    expect(evidence.records[0]?.bestAlternativeBefore?.san).toHaveLength(8);
    expect(evidence.records[0]?.bestReplyAfter?.san).toEqual(["d5", "exd5", "Qxd5"]);
    expect(isReviewEvidenceCurrent(evidence, root.fen, ["e2e4"])).toBe(true);
    expect(isReviewEvidenceCurrent(evidence, root.fen, ["d2d4"])).toBe(false);
    expect(isReviewEvidenceCurrent(evidence, "different-root", ["e2e4"])).toBe(false);
  });

  test("attaching evidence does not dirty the PGN tree or overwrite human comments", () => {
    const root = makeRoot();
    root.children[0]!.comment = "Human note";
    const store = createTreeStore(undefined, { ...defaultTree(), root });
    const evidence = buildReviewEvidence(root, "stable-game", [analysis(["e4"], 0), analysis(["d5"], 0)], [null]);

    store.getState().setReviewEvidence(evidence);

    expect(store.getState().dirty).toBe(false);
    expect(store.getState().root.children[0]?.comment).toBe("Human note");
    expect(store.getState().report.evidence?.gameId).toBe("stable-game");
  });

  test("changing Explain perspective stays local and does not dirty or alter the PGN tree", () => {
    const root = makeRoot();
    root.children[0]!.comment = "Human note";
    const store = createTreeStore(undefined, { ...defaultTree(), root });
    const fenBefore = store.getState().root.children[0]?.fen;

    store.getState().setCommentaryPerspective("black");

    expect(store.getState().commentaryPerspective).toBe("black");
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().root.children[0]?.fen).toBe(fenBefore);
    expect(store.getState().root.children[0]?.comment).toBe("Human note");
  });
});
