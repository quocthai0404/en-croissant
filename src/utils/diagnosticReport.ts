import type { GoMode, MoveAnalysis, Score } from "@/bindings";
import { generateCommentary, getChessFacts } from "@/commentary/service";
import type { CommentaryPerspective } from "@/commentary/perspective";
import { buildMoveContexts, type GeneratedComment, type MoveContext, type ViewerSide } from "@/commentary/types";
import type { GameHeaders, TreeState } from "@/utils/treeReducer";

export type DiagnosticEngineSettings = {
  name: string;
  version: string;
  goMode: GoMode;
  reversed: boolean;
  variations: boolean;
  annotateNovelties: boolean;
};

export type DiagnosticMove = MoveContext & {
  uci: string;
  facts: ReturnType<typeof getChessFacts>;
  beforePositionAnalysis: MoveAnalysis | null;
  afterPositionAnalysis: MoveAnalysis | null;
  commentary: GeneratedComment | null;
};

export type CompletedDiagnosticReport = {
  schemaVersion: 1;
  status: "complete";
  createdAt: string;
  source: { platform: "Chess.com"; url: string; pgn: string };
  game: {
    gameId: string;
    headers: GameHeaders;
    initialFen: string;
    uciMoves: string[];
    openingName: string | null;
  };
  perspective: { requested: CommentaryPerspective; resolved: ViewerSide };
  engine: DiagnosticEngineSettings & {
    scorePerspective: "white";
    analysisIndexContract: string;
  };
  analysis: MoveAnalysis[];
  moves: DiagnosticMove[];
};

export type FailedDiagnosticReport = {
  schemaVersion: 1;
  status: "error";
  createdAt: string;
  source: { platform: "Chess.com"; url: string };
  error: { stage: string; message: string };
};

export type DiagnosticReport = CompletedDiagnosticReport | FailedDiagnosticReport;

export function buildDiagnosticReportData(args: {
  url: string;
  pgn: string;
  tree: TreeState;
  gameId: string;
  uciMoves: string[];
  analysis: MoveAnalysis[];
  openingName: string;
  requestedPerspective: CommentaryPerspective;
  viewerSide: ViewerSide;
  engine: DiagnosticEngineSettings;
  createdAt: string;
}): CompletedDiagnosticReport {
  const contexts = buildMoveContexts(args.tree.root, args.gameId, args.analysis);
  const comments = generateCommentary(args.tree.root, args.gameId, args.analysis, {
    openingName: args.openingName || undefined,
    viewerSide: args.viewerSide,
  });
  const commentsByPly = new Map(comments.map((comment) => [comment.mainlinePly, comment]));

  return {
    schemaVersion: 1,
    status: "complete",
    createdAt: args.createdAt,
    source: { platform: "Chess.com", url: args.url, pgn: args.pgn },
    game: {
      gameId: args.gameId,
      headers: args.tree.headers,
      initialFen: args.tree.root.fen,
      uciMoves: args.uciMoves,
      openingName: args.openingName || null,
    },
    perspective: {
      requested: args.requestedPerspective,
      resolved: args.viewerSide,
    },
    engine: {
      ...args.engine,
      scorePerspective: "white",
      analysisIndexContract:
        "analysis[i] is the position before mainline move i; analysis[i + 1] is the position after it. The final reply may be absent when the game ends.",
    },
    analysis: args.analysis,
    moves: contexts.map((context, index) => ({
      ...context,
      uci: args.uciMoves[index] ?? "",
      facts: getChessFacts(context),
      beforePositionAnalysis: args.analysis[index] ?? null,
      afterPositionAnalysis: args.analysis[index + 1] ?? null,
      commentary: commentsByPly.get(context.mainlinePly) ?? null,
    })),
  };
}

function scoreLabel(score: Score | null | undefined): string {
  if (!score) return "not available";
  if (score.value.type === "mate") return `mate ${score.value.value}`;
  const pawns = score.value.value / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)} pawns`;
}

function bestLineLabel(line: MoveContext["bestAlternativeBefore"]): string {
  if (!line) return "not available";
  return `${line.sanMoves[0] ?? "?"} (depth ${line.depth}, ${scoreLabel(line.score)}; PV: ${line.sanMoves.join(" ") || "—"})`;
}

export function formatDiagnosticMarkdown(report: DiagnosticReport): string {
  if (report.status === "error") {
    return [
      "# Chess Review diagnostic failed",
      "",
      `- Source: ${report.source.url}`,
      `- Stage: ${report.error.stage}`,
      `- Error: ${report.error.message}`,
      `- Created: ${report.createdAt}`,
      "",
    ].join("\n");
  }

  const { headers } = report.game;
  const sections = report.moves.map((move) => {
    const moveLabel = `${move.moveNumber}${move.mover === "black" ? "..." : "."} ${move.san}`;
    const facts = move.facts.length
      ? move.facts
          .map((fact) => `${fact.code} (${fact.confidence}; ${fact.source})`)
          .join(", ")
      : "none";

    return [
      `## ${moveLabel} — ${move.mover}`,
      "",
      `- UCI: ${move.uci || "not available"}`,
      `- FEN before: ${move.fenBefore}`,
      `- FEN after: ${move.fenAfter}`,
      `- Best alternative before the move: ${bestLineLabel(move.bestAlternativeBefore)}`,
      `- Best reply after the move: ${bestLineLabel(move.bestReplyAfter)}`,
      `- Score before / after: ${scoreLabel(move.scoreBefore)} / ${scoreLabel(move.scoreAfter)} (White POV)`,
      `- Verified/advisory facts: ${facts}`,
      `- Commentary: ${move.commentary?.text ?? "No coaching comment generated for this move."}`,
      "",
    ].join("\n");
  });

  return [
    "# Chess Review diagnostic report",
    "",
    `- Source: ${report.source.url}`,
    `- Players: ${headers.white} vs ${headers.black}`,
    `- Result: ${headers.result}`,
    `- Opening: ${report.game.openingName ?? "not resolved"}`,
    `- Engine: ${report.engine.name} ${report.engine.version}`,
    `- Search: ${JSON.stringify(report.engine.goMode)}`,
    `- Perspective: ${report.perspective.requested} → ${report.perspective.resolved}`,
    `- Mainline plies: ${report.moves.length}`,
    `- Created: ${report.createdAt}`,
    "",
    "The JSON companion contains the complete Stockfish report, engine lines, move contexts, facts, plans, and rendered commentary. Scores use White's point of view.",
    "",
    ...sections,
  ].join("\n");
}
