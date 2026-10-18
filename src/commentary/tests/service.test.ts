import { Chess } from "chess.js";
import { describe, expect, test } from "vitest";
import pgn from "../../../tests/fixtures/thaidev_vs_rofu1_2026-10-18.pgn?raw";
import { createTreeStore } from "@/state/store/tree";
import { defaultTree, type TreeNode } from "@/utils/treeReducer";
import { extractGeneratedComment, mergeGeneratedComment } from "../pgnComment";
import { generateCommentary, getChessFacts } from "../service";
import { getStableGameId, type MoveContext } from "../types";

function treeFromPgn(): TreeNode {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  const state = defaultTree(history[0]?.before);
  let node = state.root;
  for (const move of history) {
    const child: TreeNode = {
      fen: move.after,
      move: null,
      san: move.san,
      children: [],
      score: null,
      depth: null,
      halfMoves: node.halfMoves + 1,
      shapes: [],
      annotations: [],
      comment: "",
    };
    node.children.push(child);
    node = child;
  }
  return state.root;
}

describe("deterministic move commentary", () => {
  test("explains 23.c4 as White opening the g7-b2 diagonal and Black's legal queen capture", () => {
    const comments = generateCommentary(treeFromPgn(), "fixture-game", []);
    const whiteMove = comments.find((item) => item.mainlinePly === 45)!;

    expect(whiteMove.facts).toContainEqual(
      expect.objectContaining({
        code: "OPENED_ATTACK_LINE",
        subjectSide: "white",
        actor: { side: "black", type: "b", square: "g7" },
        blocker: { side: "white", type: "p", square: "c3" },
        target: { side: "white", type: "q", square: "b2" },
        evidenceMoves: ["Bxb2"],
        confidence: "verified",
      }),
    );
    expect(whiteMove.text).toContain("23.c4");
    expect(whiteMove.text).toContain("tốt Trắng rời c3");
    expect(whiteMove.text).toContain("23...Bxb2");
    expect(whiteMove.position).toHaveLength(45);
    expect(whiteMove.facts).toContainEqual(
      expect.objectContaining({
        code: "PIECE_UNDER_ATTACK",
        subjectSide: "white",
        target: { side: "white", type: "q", square: "b2" },
        evidenceMoves: ["Bxb2"],
        confidence: "verified",
      }),
    );

    const blackMove = comments.find((item) => item.mainlinePly === 46)!;
    expect(blackMove.position).toHaveLength(46);
    expect(blackMove.text).toContain("23...Bxb2");
    expect(blackMove.text).toContain("ăn hậu Trắng ở b2");
    expect(blackMove.facts).toContainEqual(
      expect.objectContaining({
        code: "CAPTURED_PIECE",
        subjectSide: "black",
        target: { side: "white", type: "q", square: "b2" },
        confidence: "verified",
      }),
    );
    expect(comments[0]?.text).toContain("chưa có dữ kiện đủ chắc");
  });

  test("returns no chess facts for invalid FEN or SAN", () => {
    const invalid: MoveContext = {
      gameId: "bad",
      mainlinePly: 1,
      position: [0],
      moveNumber: 1,
      mover: "white",
      san: "not-a-move",
      fenBefore: "not a fen",
      fenAfter: "not a fen",
      annotation: null,
      scoreBefore: null,
      scoreAfter: null,
      bestLineSan: [],
    };
    expect(getChessFacts(invalid)).toEqual([]);
  });

  test("recognizes checkmate and keeps game identity independent of variations", () => {
    const mate: MoveContext = {
      gameId: "mate-test",
      mainlinePly: 1,
      position: [0],
      moveNumber: 1,
      mover: "white",
      san: "Qg7#",
      fenBefore: "7k/8/5KQ1/8/8/8/8/8 w - - 0 1",
      fenAfter: "7k/6Q1/5K2/8/8/8/8/8 b - - 1 1",
      annotation: null,
      scoreBefore: null,
      scoreAfter: null,
      bestLineSan: [],
    };
    expect(getChessFacts(mate)).toContainEqual(
      expect.objectContaining({ code: "MATE", subjectSide: "white", confidence: "verified" }),
    );
    expect(getStableGameId("position", ["e2e4", "e7e5"])).toBe(
      getStableGameId("position", ["e2e4", "e7e5"]),
    );
    expect(getStableGameId("position", ["e2e4", "e7e5"])).not.toBe(
      getStableGameId("position", ["e2e4", "c7c5"]),
    );
  });

  test("describes castling factually without promising a safer king", () => {
    const chess = new Chess();
    const history = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "O-O"].map((san) =>
      chess.move(san),
    );
    const state = defaultTree();
    let node = state.root;
    for (const move of history) {
      const child: TreeNode = {
        fen: move.after,
        move: null,
        san: move.san,
        children: [],
        score: null,
        depth: null,
        halfMoves: node.halfMoves + 1,
        shapes: [],
        annotations: [],
        comment: "",
      };
      node.children.push(child);
      node = child;
    }

    const castle = generateCommentary(state.root, "castle-test", []).find(
      (item) => item.mainlinePly === 7,
    )!;
    expect(castle.text).toContain("4.O-O nhập thành, chuyển vua và xe bằng một nước đi.");
    expect(castle.text).not.toContain("an toàn hơn");
  });

  test("preserves a human note and replaces generated text idempotently", () => {
    const state = defaultTree();
    state.root.children.push({
      ...state.root,
      san: "e4",
      halfMoves: 1,
      children: [],
      comment: "human note",
    });
    state.root.children.push({
      ...state.root.children[0]!,
      san: "d4",
      generatedComment: {
        schemaVersion: 1,
        gameId: "old-game",
        ply: 1,
        text: "Bình luận cũ ở biến.",
      },
    });
    const store = createTreeStore(undefined, state);
    const set = store.getState().setGeneratedComments;
    set([
      {
        position: [0],
        comment: { schemaVersion: 1, gameId: "game-1", ply: 1, text: "Nước tự động." },
      },
    ]);
    set([
      {
        position: [0],
        comment: { schemaVersion: 1, gameId: "game-1", ply: 1, text: "Nước tự động mới." },
      },
    ]);

    const node = store.getState().root.children[0]!;
    expect(node.comment).toBe("human note");
    expect(node.generatedComment).toEqual({
      schemaVersion: 1,
      gameId: "game-1",
      ply: 1,
      text: "Nước tự động mới.",
    });
    expect(store.getState().root.children[1]?.generatedComment).toBeUndefined();
  });

  test("round-trips generated PGN markers without changing the human comment", () => {
    const original = "Ghi chú của người chơi.";
    const metadata = {
      schemaVersion: 1 as const,
      gameId: "game-1",
      ply: 45,
      text: "Bình luận tự động 23.c4.",
    };
    const exported = mergeGeneratedComment(original, metadata);
    expect(exported).toContain("[Chess Reviewer: Bình luận tự động]\nBình luận tự động 23.c4.");
    expect(extractGeneratedComment(exported)).toEqual({
      comment: original,
      generatedComment: metadata,
    });
    expect(
      extractGeneratedComment("{[[%en-croissant-generated-v1:T%E1%BB%B1%20%C4%91%E1%BB%99ng.]]}", 3),
    ).toEqual({
      comment: "{}",
      generatedComment: { schemaVersion: 1, gameId: "pgn-import", ply: 3, text: "Tự động." },
    });
  });
});
