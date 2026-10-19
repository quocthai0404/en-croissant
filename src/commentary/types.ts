import type { BestMoves, MoveAnalysis, Score } from "@/bindings";
import type { Annotation } from "@/utils/annotation";
import type { TreeNode } from "@/utils/treeReducer";
import { Chess } from "chess.js";
import { getAnnotation } from "@/utils/score";

export type Side = "white" | "black";
export type ViewerSide = Side | "neutral";
export type CommentaryIntent =
  | "mate"
  | "mate-threat"
  | "opened-attack"
  | "capture-opportunity"
  | "capture"
  | "check"
  | "castling"
  | "development"
  | "opening";

export interface CommentaryEvent {
  id: string;
  role: "cause" | "exploitation";
  relatedPly: number;
  result: "actual" | "engine-recommended" | "legal-capture";
}

export interface CommentaryEngineEvidence {
  bestAlternativeBefore?: { san: string; depth: number; score: Score };
  bestReplyAfter?: { san: string; depth: number; score: Score };
}

export interface CommentaryPlan {
  moveId: string;
  gameId: string;
  mainlinePly: number;
  mover: Side;
  moveNumber: number;
  san: string;
  intent: CommentaryIntent;
  facts: ChessFact[];
  event?: CommentaryEvent;
  openingName?: string;
  engineEvidence?: CommentaryEngineEvidence;
}

export type FactCode =
  | "CAPTURED_PIECE"
  | "OPENED_ATTACK_LINE"
  | "LEGAL_CAPTURE_AVAILABLE"
  | "ENGINE_RECOMMENDED_CAPTURE"
  | "CHECK"
  | "MATE"
  | "ALLOWS_MATE"
  | "CASTLING"
  | "DEVELOPMENT"
  | "FORK_CANDIDATE"
  | "HANGING_PIECE_CANDIDATE";

export interface FactPiece {
  side: Side;
  type: "p" | "n" | "b" | "r" | "q" | "k";
  square: string;
}

export interface ChessFact {
  id: string;
  code: FactCode;
  subjectSide: Side;
  actor?: FactPiece;
  blocker?: FactPiece;
  target?: FactPiece;
  squares?: string[];
  evidenceMoves?: string[];
  /** Verified means the stated observation is proven; it does not imply a forced or lasting win. */
  confidence: "verified" | "heuristic";
  source: "patzer" | "adapter";
}

export interface MoveContext {
  gameId: string;
  mainlinePly: number;
  position: number[];
  moveNumber: number;
  mover: Side;
  san: string;
  fenBefore: string;
  fenAfter: string;
  annotation: Annotation | null;
  scoreBefore: Score | null;
  scoreAfter: Score | null;
  bestAlternativeBefore: BestMoves | null;
  bestReplyAfter: BestMoves | null;
}

export interface GeneratedComment {
  mainlinePly: number;
  position: number[];
  text: string;
  facts: ChessFact[];
  plan: CommentaryPlan;
}

/** Stable across report retries and variation changes; identity follows the actual game line. */
export function getStableGameId(initialFen: string, uciMoves: string[]): string {
  const identity = `${initialFen.trim()}\n${uciMoves.join(" ")}`;
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of identity) {
    const code = character.charCodeAt(0);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + 0x9e3779b9), 0x85ebca6b);
  }
  return `game-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildMoveContexts(
  root: TreeNode,
  gameId: string,
  analysis: MoveAnalysis[],
): MoveContext[] {
  const contexts: MoveContext[] = [];
  let parent = root;
  let childIndex = 0;

  while (parent.children.length > 0) {
    const child = parent.children[0]!;
    if (!child.san) break;

    try {
      const before = new Chess(parent.fen);
      const mover = before.turn() === "w" ? "white" : "black";
      const moveNumber = before.moveNumber();
      const mainlinePly = (moveNumber - 1) * 2 + (mover === "white" ? 1 : 2);
      const move = before.move(child.san, { strict: false });
      const afterFields = before.fen().split(" ");
      const childFields = child.fen.split(" ");
      if (afterFields.slice(0, 4).join(" ") !== childFields.slice(0, 4).join(" ")) {
        parent = child;
        childIndex++;
        continue;
      }
      const beforeAnalysis = analysis[childIndex];
      const afterAnalysis = analysis[childIndex + 1];
      const best = beforeAnalysis?.best?.[0];
      const previousScore = beforeAnalysis?.best?.[0]?.score ?? parent.score;
      const currentScore = afterAnalysis?.best?.[0]?.score ?? child.score;
      const annotation =
        beforeAnalysis?.best?.[0] && afterAnalysis?.best?.[0]
          ? (getAnnotation(
              analysis[childIndex - 1]?.best?.[0]?.score.value ?? null,
              previousScore?.value ?? null,
              currentScore?.value ?? null,
              mover,
              beforeAnalysis.best,
              afterAnalysis.is_sacrifice,
              move.san,
            ) ?? null)
          : null;

      contexts.push({
        gameId,
        mainlinePly,
        position: Array.from({ length: childIndex + 1 }, () => 0),
        moveNumber,
        mover,
        san: move.san,
        fenBefore: parent.fen,
        fenAfter: child.fen,
        annotation,
        scoreBefore: previousScore,
        scoreAfter: currentScore,
        bestAlternativeBefore: best ?? null,
        bestReplyAfter: afterAnalysis?.best?.[0] ?? null,
      });
    } catch {
      // Skip an invalid tree edge safely. PGN import and the engine report remain usable.
    }

    parent = child;
    childIndex++;
  }

  return contexts;
}
