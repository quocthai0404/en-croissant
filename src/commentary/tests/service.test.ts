import { Chess } from "chess.js";
import { parseUci } from "chessops";
import { describe, expect, test } from "vitest";
import { createTreeStore } from "@/state/store/tree";
import { defaultTree, getNodeAtPath, type TreeNode } from "@/utils/treeReducer";
import { extractGeneratedComment, mergeGeneratedComment } from "../pgnComment";
import {
  generateCommentary,
  getChessFacts,
  getCommentsForPerspective,
  renderCommentaryPlan,
} from "../service";
import { buildMoveContexts, getStableGameId, type MoveContext } from "../types";
import type { MoveAnalysis } from "@/bindings";
import { resolveViewerSide } from "../perspective";
import { buildDiagnosticReportData, formatDiagnosticMarkdown } from "@/utils/diagnosticReport";
import { buildReviewEvidence } from "@/review/evidence";
import { buildExplainPresentation } from "@/review/explain";

// Minimal mainline only; keep the regression case reproducible without publishing a raw PGN.
const goldenMoves = `1. e4 d5 2. exd5 c6 3. dxc6 Nxc6 4. Bb5 Bd7 5. Nf3 Nf6 6. O-O g6
7. Re1 Bg7 8. c3 O-O 9. d4 a6 10. Bd3 e6 11. Bg5 Qb6 12. b4 a5
13. b5 Na7 14. Nbd2 Bxb5 15. Bxb5 Nxb5 16. Rb1 Qc6 17. Qb3 Nd6
18. Ne5 Qc7 19. Rbc1 Nf5 20. d5 Nxd5 21. Ng4 a4 22. Qb2 Qa5
23. c4 Bxb2 24. Rb1 Bc3 0-1`;

function cpScore(value: number): MoveAnalysis["best"][number]["score"] {
  return { value: { type: "cp", value }, wdl: null };
}

function analysisAt(pv: string, score: number, depth = 20): MoveAnalysis {
  return {
    best: pv
      ? [
          {
            nodes: 1000,
            depth,
            score: cpScore(score),
            uciMoves: [],
            sanMoves: [pv],
            multipv: 1,
            nps: 50000,
          },
        ]
      : [],
    novelty: false,
    is_sacrifice: false,
  };
}

function treeFromPgn(pgn: string = goldenMoves): TreeNode {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  const state = defaultTree(history[0]?.before);
  let node = state.root;
  for (const move of history) {
    const child: TreeNode = {
      fen: move.after,
      move: parseUci(`${move.from}${move.to}${move.promotion ?? ""}`)!,
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
  test("attaches a local opening name only to the first mainline commentary context", () => {
    const comments = generateCommentary(treeFromPgn(), "fixture-game", [], {
      openingName: "Scandinavian Defense: Blackburne Gambit",
    });
    const openingComment = comments.find((comment) => comment.plan.openingName);

    expect(openingComment?.plan.openingName).toBe("Scandinavian Defense: Blackburne Gambit");
    expect(openingComment?.text).toContain("Phòng thủ Scandinavia");
    expect(comments.filter((comment) => comment.plan.openingName)).toHaveLength(1);
  });

  test("adapts pre-move alternatives and post-move replies from adjacent positions", () => {
    const analysis = Array.from({ length: 49 }, (_, index) => analysisAt(`move-${index}`, index));
    analysis[44] = analysisAt("Rb1", 35, 31);
    analysis[45] = analysisAt("Bxb2", -620, 32);
    analysis[46] = analysisAt("Rb1", -480, 30);

    const contexts = buildMoveContexts(treeFromPgn(), "fixture-game", analysis);
    const whiteC4 = contexts.find((context) => context.mainlinePly === 45)!;
    const blackBxb2 = contexts.find((context) => context.mainlinePly === 46)!;

    expect(whiteC4.bestAlternativeBefore?.sanMoves[0]).toBe("Rb1");
    expect(whiteC4.bestAlternativeBefore?.depth).toBe(31);
    expect(whiteC4.bestReplyAfter?.sanMoves[0]).toBe("Bxb2");
    expect(whiteC4.bestReplyAfter?.score.value).toEqual({ type: "cp", value: -620 });
    expect(whiteC4.scoreBefore?.value).toEqual({ type: "cp", value: 35 });
    expect(whiteC4.scoreAfter?.value).toEqual({ type: "cp", value: -620 });

    expect(blackBxb2.mover).toBe("black");
    expect(blackBxb2.bestAlternativeBefore?.sanMoves[0]).toBe("Bxb2");
    expect(blackBxb2.bestReplyAfter?.sanMoves[0]).toBe("Rb1");
    expect(blackBxb2.scoreBefore?.value).toEqual({ type: "cp", value: -620 });
    expect(blackBxb2.scoreAfter?.value).toEqual({ type: "cp", value: -480 });
  });

  test("diagnostic export keeps the engine alternative, reply, facts, and commentary distinct", () => {
    const analysis = Array.from({ length: 49 }, (_, index) => analysisAt(`move-${index}`, index));
    analysis[44] = analysisAt("Rb1", 35, 31);
    analysis[45] = analysisAt("Bxb2", -620, 32);
    analysis[46] = analysisAt("Rb1", -480, 30);
    const tree = defaultTree();
    tree.root = treeFromPgn();

    const report = buildDiagnosticReportData({
      url: "https://www.chess.com/game/live/123456789",
      pgn: goldenMoves,
      tree,
      gameId: "fixture-game",
      uciMoves: Array.from({ length: 48 }, () => "a2a3"),
      analysis,
      openingName: "Scandinavian Defense",
      requestedPerspective: "neutral",
      viewerSide: "neutral",
      engine: {
        name: "Stockfish 19",
        version: "19",
        goMode: { t: "Time", c: 500 },
        reversed: true,
        variations: true,
        annotateNovelties: false,
      },
      createdAt: "2026-10-19T00:00:00.000Z",
    });

    const c4 = report.moves.find((move) => move.mainlinePly === 45)!;
    expect(c4.bestAlternativeBefore?.sanMoves[0]).toBe("Rb1");
    expect(c4.beforePositionAnalysis).toBe(analysis[44]);
    expect(c4.bestReplyAfter?.sanMoves[0]).toBe("Bxb2");
    expect(c4.afterPositionAnalysis).toBe(analysis[45]);
    expect(c4.facts).toContainEqual(expect.objectContaining({ code: "OPENED_ATTACK_LINE" }));
    expect(c4.commentary).not.toBeNull();
    expect(c4.commentary?.plan.engineEvidence?.bestReplyAfter?.san).toBe("Bxb2");

    const markdown = formatDiagnosticMarkdown(report);
    expect(markdown).toContain("Best alternative before the move: Rb1");
    expect(markdown).toContain("Best reply after the move: Bxb2");
    expect(markdown).toContain(c4.commentary!.text);
  });

  test("accepts chronological report output after reversed engine traversal", () => {
    const chronological = Array.from({ length: 49 }, (_, index) => analysisAt(`move-${index}`, index));
    chronological[44] = analysisAt("Rb1", 35);
    chronological[45] = analysisAt("Bxb2", -620);

    // The native command restores input order after analyzing reversed positions.
    const reversedEngineTraversal = [...chronological].reverse();
    const reversedTraversalOutput = [...reversedEngineTraversal].reverse();
    const whiteC4 = buildMoveContexts(treeFromPgn(), "fixture-game", reversedTraversalOutput).find(
      (context) => context.mainlinePly === 45,
    )!;

    expect(whiteC4.bestAlternativeBefore?.sanMoves[0]).toBe("Rb1");
    expect(whiteC4.bestReplyAfter?.sanMoves[0]).toBe("Bxb2");
  });

  test("keeps a missing final-position analysis empty instead of shifting evidence", () => {
    const withoutFinalPosition = Array.from({ length: 48 }, (_, index) => analysisAt(`move-${index}`, index));
    const lastMove = buildMoveContexts(treeFromPgn(), "fixture-game", withoutFinalPosition).at(-1)!;

    expect(lastMove.mainlinePly).toBe(48);
    expect(lastMove.bestAlternativeBefore?.sanMoves[0]).toBe("move-47");
    expect(lastMove.bestReplyAfter).toBeNull();
    expect(lastMove.scoreAfter).toBeNull();
  });

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
    expect(whiteMove.plan.intent).toBe("opened-attack");
    expect(whiteMove.text).toContain("Trắng đẩy tốt");
    expect(whiteMove.text).toContain("khiến hậu Trắng lọt vào tầm bắt");
    expect(whiteMove.text).not.toContain("bắt hậu Trắng");
    expect(whiteMove.position).toHaveLength(45);
    expect(whiteMove.facts).toContainEqual(
      expect.objectContaining({
        code: "LEGAL_CAPTURE_AVAILABLE",
        subjectSide: "white",
        target: { side: "white", type: "q", square: "b2" },
        evidenceMoves: ["Bxb2"],
        confidence: "verified",
      }),
    );

    const blackMove = comments.find((item) => item.mainlinePly === 46)!;
    expect(blackMove.position).toHaveLength(46);
    expect(blackMove.plan.event?.id).toBe(whiteMove.plan.event?.id);
    expect(blackMove.text).toContain("tận dụng sơ hở vừa mở ra");
    expect(blackMove.text).toContain("bắt hậu Trắng");
    expect(blackMove.text).not.toContain("đường tượng");
    expect(blackMove.facts).toContainEqual(
      expect.objectContaining({
        code: "CAPTURED_PIECE",
        subjectSide: "black",
        target: { side: "white", type: "q", square: "b2" },
        confidence: "verified",
      }),
    );
  });

  test("V3 evidence preserves the 23.c4 opportunity and links the actual 23...Bxb2 capture", () => {
    const root = treeFromPgn();
    const analysis = Array.from({ length: 49 }, (_, index) => analysisAt(`move-${index}`, 0, 30));
    analysis[44] = analysisAt("Rb1", -400, 30);
    analysis[45] = analysisAt("Bxb2", -620, 30);
    analysis[46] = analysisAt("Rb1", -480, 30);
    const evidence = buildReviewEvidence(root, "fixture-review", analysis, Array(48).fill(null));
    const c4 = evidence.records.find((record) => record.mainlinePly === 45)!;
    const bxb2 = evidence.records.find((record) => record.mainlinePly === 46)!;
    const c4Explain = buildExplainPresentation(c4, evidence.records, "white");
    const captureExplain = buildExplainPresentation(bxb2, evidence.records, "white");

    expect(c4.facts).toContainEqual(expect.objectContaining({ code: "OPENED_ATTACK_LINE", evidenceMoves: ["Bxb2"] }));
    expect(c4.facts).toContainEqual(expect.objectContaining({ code: "LEGAL_CAPTURE_AVAILABLE", evidenceMoves: ["Bxb2"] }));
    expect(c4.event).toMatchObject({ role: "cause", result: "actual", relatedPly: 46 });
    expect(captureExplain.paragraphs[0]).toContain("23...Bxb2 bắt hậu của bạn tại b2");
    expect(captureExplain.paragraphs[0]).toContain("sơ hở do 23.c4");
    expect(c4Explain.paragraphs.join(" ")).not.toContain("đã mất hậu");
    expect(captureExplain.overlay.some((shape) => shape.orig === "g7" && shape.dest === "b2")).toBe(true);
  });

  test("separates legal capture, engine recommendation, and realized material capture", () => {
    const root = treeFromPgn();
    const plainContexts = buildMoveContexts(root, "fixture-game", []);
    const c4WithoutEngine = plainContexts.find((context) => context.mainlinePly === 45)!;
    const c4PlainFacts = getChessFacts(c4WithoutEngine);

    expect(c4PlainFacts).toContainEqual(
      expect.objectContaining({ code: "LEGAL_CAPTURE_AVAILABLE", evidenceMoves: ["Bxb2"] }),
    );
    expect(c4PlainFacts.some((fact) => fact.code === "ENGINE_RECOMMENDED_CAPTURE")).toBe(false);

    const analysis = Array.from({ length: 46 }, () => analysisAt("", 0));
    analysis[45] = analysisAt("Bxb2", -620);
    const analyzedC4 = buildMoveContexts(root, "fixture-game", analysis).find(
      (context) => context.mainlinePly === 45,
    )!;
    expect(getChessFacts(analyzedC4)).toContainEqual(
      expect.objectContaining({ code: "ENGINE_RECOMMENDED_CAPTURE", evidenceMoves: ["Bxb2"] }),
    );

    analysis[45] = analysisAt("Bxb2", -620, 9);
    const shallowReply = buildMoveContexts(root, "fixture-game", analysis).find(
      (context) => context.mainlinePly === 45,
    )!;
    expect(getChessFacts(shallowReply).some((fact) => fact.code === "ENGINE_RECOMMENDED_CAPTURE")).toBe(false);

    analysis[45] = analysisAt("a6", -620);
    const mismatchedReply = buildMoveContexts(root, "fixture-game", analysis).find(
      (context) => context.mainlinePly === 45,
    )!;
    expect(getChessFacts(mismatchedReply).some((fact) => fact.code === "ENGINE_RECOMMENDED_CAPTURE")).toBe(
      false,
    );

    const actualCapture = plainContexts.find((context) => context.mainlinePly === 46)!;
    expect(getChessFacts(actualCapture)).toContainEqual(
      expect.objectContaining({
        code: "CAPTURED_PIECE",
        target: expect.objectContaining({ type: "q", square: "b2" }),
      }),
    );
  });

  test("resolves automatic perspective only from an unambiguous player identity match", () => {
    const headers = { ...defaultTree().headers, white: "Rofu1", black: "Thaidev" };
    const blackSessions = [{ player: "  THAIDEV ", updatedAt: 0 }];
    expect(resolveViewerSide("auto", headers, blackSessions)).toBe("black");
    expect(
      resolveViewerSide("auto", { ...headers, orientation: "white" }, blackSessions),
    ).toBe("black");
    expect(resolveViewerSide("auto", headers, [{ player: "Rofu1", updatedAt: 0 }])).toBe("white");
    expect(
      resolveViewerSide("auto", headers, [
        { player: "Rofu1", updatedAt: 0 },
        { player: "Thaidev", updatedAt: 0 },
      ]),
    ).toBe("neutral");
    expect(resolveViewerSide("auto", headers, [])).toBe("neutral");
    expect(resolveViewerSide("white", headers, [{ player: "Thaidev", updatedAt: 0 }])).toBe("white");
  });

  test("re-renders stored V2 plans locally for White, Black, and Neutral perspectives", () => {
    const root = treeFromPgn();
    const comments = generateCommentary(root, "fixture-game", []);
    for (const generated of comments.filter((comment) => [45, 46].includes(comment.mainlinePly))) {
      const node = getNodeAtPath(root, generated.position);
      node.generatedComment = {
        schemaVersion: 2,
        gameId: "fixture-game",
        ply: generated.mainlinePly,
        text: generated.text,
        plan: generated.plan,
      };
    }

    const headers = { ...defaultTree().headers, white: "Rofu1", black: "Thaidev" };
    const white = getCommentsForPerspective(root, "white", headers, []);
    const black = getCommentsForPerspective(root, "black", headers, []);
    const neutral = getCommentsForPerspective(root, "neutral", headers, []);
    const whiteC4 = white.find((item) => item.comment.ply === 45)!.comment.text;
    const blackC4 = black.find((item) => item.comment.ply === 45)!.comment.text;
    const blackCapture = black.find((item) => item.comment.ply === 46)!.comment.text;
    const whiteCapture = white.find((item) => item.comment.ply === 46)!.comment.text;

    expect(whiteC4).toContain("Bạn đẩy tốt");
    expect(blackC4).toContain("Đối thủ đẩy tốt");
    expect(blackC4).toContain("tượng của bạn");
    expect(blackCapture).toContain("Bạn tận dụng sơ hở");
    expect(whiteCapture).toContain("Đối thủ tận dụng sơ hở");
    expect(blackCapture).toContain("hậu của đối thủ");
    expect(whiteCapture).toContain("hậu của bạn");
    expect(neutral.find((item) => item.comment.ply === 45)?.comment.text).toContain("Trắng đẩy tốt");
    expect(neutral.find((item) => item.comment.ply === 46)?.comment.text).toContain("Đen tận dụng");
    expect(root.children[0]?.generatedComment).toBeUndefined();
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
      bestAlternativeBefore: null,
      bestReplyAfter: null,
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
      bestAlternativeBefore: null,
      bestReplyAfter: null,
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

  test("mate-threat narration is perspective-correct and grammatically complete", () => {
    const text = renderCommentaryPlan(
      {
        moveId: "mate-threat-test:5",
        gameId: "mate-threat-test",
        mainlinePly: 5,
        mover: "white",
        moveNumber: 3,
        san: "Qh5",
        intent: "mate-threat",
        facts: [],
      },
      "black",
    );

    expect(text).toContain("Đối thủ vừa để bạn có cơ hội chiếu hết ngay");
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
    expect(castle.text).toContain("Trắng nhập thành");
    expect(castle.text).toContain("đưa xe tham gia ván đấu");
    expect(castle.text).not.toContain("an toàn hơn");
  });

  test("manual quality case: Black receives natural, perspective-correct tactical coaching", () => {
    const comments = generateCommentary(treeFromPgn(), "fixture-game", [], { viewerSide: "black" });
    const exposure = comments.find((comment) => comment.mainlinePly === 45)!;
    const capture = comments.find((comment) => comment.mainlinePly === 46)!;

    expect(exposure.text).toBe(
      "Đối thủ đẩy tốt khỏi đường chéo do tượng của bạn kiểm soát, khiến hậu của đối thủ lọt vào tầm bắt. Trước khi đẩy quân chắn, hãy kiểm tra đường tấn công nó đang che.",
    );
    expect(capture.text).toBe("Bạn tận dụng sơ hở vừa tạo ra và bắt được hậu của đối thủ.");
  });

  test("manual quality case: the opening introduction is translated and appears once", () => {
    const comments = generateCommentary(treeFromPgn(), "fixture-game", [], {
      openingName: "Scandinavian Defense: Blackburne Gambit",
      viewerSide: "neutral",
    });
    const opening = comments.find((comment) => comment.plan.openingName);

    expect(opening?.text).toBe(
      "Ván này theo Phòng thủ Scandinavia: Đen phản công trung tâm ngay từ đầu. Sau loạt đổi tốt, hãy phát triển quân nhẹ trước khi tìm cách ăn thêm tốt.",
    );
    expect(comments.filter((comment) => comment.plan.openingName)).toHaveLength(1);
  });

  test("manual quality case: a quiet move does not receive a fabricated explanation", () => {
    const comments = generateCommentary(treeFromPgn("1. e4 *"), "quiet-game", []);
    expect(comments).toEqual([]);
  });

  test("manual quality case: an engine-recommended capture stays conditional until played", () => {
    const prefix = goldenMoves.slice(0, goldenMoves.indexOf(" Bxb2 24."));
    const root = treeFromPgn(`${prefix} *`);
    const analysis = Array.from({ length: 46 }, () => analysisAt("", 0));
    analysis[45] = analysisAt("Bxb2", -620, 32);
    const exposure = generateCommentary(root, "unfinished-game", analysis, {
      viewerSide: "black",
    }).find((comment) => comment.mainlinePly === 45)!;

    expect(exposure.plan.event?.result).toBe("engine-recommended");
    expect(exposure.text).toContain("Máy phân tích ưu tiên nước bắt hậu");
    expect(exposure.text).toContain("kiểm tra xem quân bắt có thể bị đổi lại không");
    expect(exposure.text).not.toContain("Ở nước tiếp theo");
    expect(exposure.text).not.toMatch(/đã bắt được|bắt buộc phải|thắng chắc/i);
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

  test("invalidates legacy text-only comments on perspective change and preserves human notes", () => {
    const state = defaultTree();
    state.root.children.push({
      ...state.root,
      san: "e4",
      halfMoves: 1,
      children: [],
      comment: "keep this note",
      generatedComment: {
        schemaVersion: 1,
        gameId: "legacy-game",
        ply: 1,
        text: "Legacy generated text.",
      },
    });
    const store = createTreeStore(undefined, state);
    const updates = getCommentsForPerspective(
      store.getState().root,
      "black",
      store.getState().headers,
      [],
    );

    expect(updates).toEqual([]);
    store.getState().setCommentaryPerspective("black");
    store.getState().setGeneratedComments(updates);

    const node = store.getState().root.children[0]!;
    expect(node.generatedComment).toBeUndefined();
    expect(node.comment).toBe("keep this note");
    expect(store.getState().commentaryPerspective).toBe("black");
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

    const generated = generateCommentary(treeFromPgn(), "fixture-game", []).find(
      (comment) => comment.mainlinePly === 45,
    )!;
    const v2 = {
      schemaVersion: 2 as const,
      gameId: "fixture-game",
      ply: 45,
      text: generated.text,
      plan: generated.plan,
    };
    expect(extractGeneratedComment(mergeGeneratedComment(original, v2))).toEqual({
      comment: original,
      generatedComment: v2,
    });
  });
});
