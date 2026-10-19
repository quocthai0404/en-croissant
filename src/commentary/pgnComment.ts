import type { GeneratedCommentMetadata } from "@/utils/treeReducer";
import type { ChessFact, CommentaryIntent, CommentaryPlan, FactPiece, Side } from "./types";

const GENERATED_COMMENT_MARKER = /\[\[%en-croissant-generated-v1:([^\]]*)\]\]/g;
const COMMENTARY_INTENTS = new Set<CommentaryIntent>([
  "mate",
  "mate-threat",
  "opened-attack",
  "capture-opportunity",
  "capture",
  "check",
  "castling",
  "development",
  "opening",
]);
const FACT_CODES = new Set<ChessFact["code"]>([
  "CAPTURED_PIECE",
  "OPENED_ATTACK_LINE",
  "LEGAL_CAPTURE_AVAILABLE",
  "ENGINE_RECOMMENDED_CAPTURE",
  "CHECK",
  "MATE",
  "ALLOWS_MATE",
  "CASTLING",
  "DEVELOPMENT",
  "FORK_CANDIDATE",
  "HANGING_PIECE_CANDIDATE",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSide(value: unknown): value is Side {
  return value === "white" || value === "black";
}

function isFactPiece(value: unknown): value is FactPiece {
  return (
    isRecord(value) &&
    isSide(value.side) &&
    ["p", "n", "b", "r", "q", "k"].includes(String(value.type)) &&
    typeof value.square === "string"
  );
}

function isChessFact(value: unknown): value is ChessFact {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    FACT_CODES.has(value.code as ChessFact["code"]) &&
    isSide(value.subjectSide) &&
    (value.confidence === "verified" || value.confidence === "heuristic") &&
    (value.source === "adapter" || value.source === "patzer") &&
    (value.actor === undefined || isFactPiece(value.actor)) &&
    (value.blocker === undefined || isFactPiece(value.blocker)) &&
    (value.target === undefined || isFactPiece(value.target)) &&
    (value.squares === undefined || (Array.isArray(value.squares) && value.squares.every((x) => typeof x === "string"))) &&
    (value.evidenceMoves === undefined || (Array.isArray(value.evidenceMoves) && value.evidenceMoves.every((x) => typeof x === "string")))
  );
}

function isEngineSummary(value: unknown): boolean {
  const score = isRecord(value) ? value.score : undefined;
  const scoreValue = isRecord(score) ? score.value : undefined;
  return (
    isRecord(value) &&
    typeof value.san === "string" &&
    typeof value.depth === "number" &&
    Number.isFinite(value.depth) &&
    isRecord(score) &&
    isRecord(scoreValue) &&
    ["cp", "mate", "dtz"].includes(String(scoreValue.type)) &&
    typeof scoreValue.value === "number" &&
    Number.isFinite(scoreValue.value)
  );
}

function isCommentaryPlan(value: unknown): value is CommentaryPlan {
  if (
    !isRecord(value) ||
    typeof value.moveId !== "string" ||
    typeof value.gameId !== "string" ||
    !Number.isInteger(value.mainlinePly) ||
    Number(value.mainlinePly) < 1 ||
    value.moveId !== `${value.gameId}:${value.mainlinePly}` ||
    !isSide(value.mover) ||
    !Number.isInteger(value.moveNumber) ||
    Number(value.moveNumber) < 1 ||
    typeof value.san !== "string" ||
    value.san.length === 0 ||
    !COMMENTARY_INTENTS.has(value.intent as CommentaryIntent) ||
    !Array.isArray(value.facts) ||
    !value.facts.every(isChessFact)
  ) {
    return false;
  }

  if (value.event !== undefined) {
    const event = value.event;
    if (
      !isRecord(event) ||
      typeof event.id !== "string" ||
      (event.role !== "cause" && event.role !== "exploitation") ||
      !Number.isInteger(event.relatedPly) ||
      !["actual", "engine-recommended", "legal-capture"].includes(String(event.result))
    ) {
      return false;
    }
  }

  if (value.openingName !== undefined && typeof value.openingName !== "string") return false;
  if (value.engineEvidence !== undefined) {
    const evidence = value.engineEvidence;
    if (
      !isRecord(evidence) ||
      (evidence.bestAlternativeBefore !== undefined && !isEngineSummary(evidence.bestAlternativeBefore)) ||
      (evidence.bestReplyAfter !== undefined && !isEngineSummary(evidence.bestReplyAfter))
    ) {
      return false;
    }
  }

  return true;
}

function isV2Metadata(value: unknown): value is Extract<GeneratedCommentMetadata, { schemaVersion: 2 }> {
  return (
    isRecord(value) &&
    value.schemaVersion === 2 &&
    typeof value.gameId === "string" &&
    typeof value.ply === "number" &&
    Number.isInteger(value.ply) &&
    typeof value.text === "string" &&
    value.text.length > 0 &&
    isCommentaryPlan(value.plan) &&
    value.plan.gameId === value.gameId &&
    value.plan.mainlinePly === value.ply
  );
}

function isV1Metadata(value: unknown): value is Extract<GeneratedCommentMetadata, { schemaVersion: 1 }> {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.gameId === "string" &&
    typeof value.ply === "number" &&
    Number.isInteger(value.ply) &&
    typeof value.text === "string" &&
    value.text.length > 0
  );
}

/** Encode generated prose inside an ordinary PGN comment without altering user prose. */
export function mergeGeneratedComment(
  comment: string,
  generatedComment?: GeneratedCommentMetadata,
): string {
  if (!generatedComment?.text) return comment;
  const marker = `[[%en-croissant-generated-v1:${encodeURIComponent(JSON.stringify(generatedComment))}]]`;
  const visibleGeneratedText = `[Chess Reviewer: Bình luận tự động]\n${generatedComment.text}`;
  const generatedSegment = `${visibleGeneratedText}\n\n${marker}`;
  return comment ? `${comment}\n\n${generatedSegment}` : generatedSegment;
}

/** Split our export marker back into separate persisted fields when importing a PGN. */
export function extractGeneratedComment(value: string, fallbackPly = 0): {
  comment: string;
  generatedComment?: GeneratedCommentMetadata;
} {
  const matches = [...value.matchAll(GENERATED_COMMENT_MARKER)];
  const match = matches.at(-1);
  if (!match || match.index === undefined) return { comment: value };

  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]!);
  } catch {
    return { comment: value };
  }
  if (!decoded) return { comment: value };

  let generatedComment: GeneratedCommentMetadata;
  try {
    const parsed: unknown = JSON.parse(decoded);
    if (isV2Metadata(parsed)) {
      generatedComment = parsed;
    } else if (isV1Metadata(parsed)) {
      generatedComment = parsed;
    } else if (isRecord(parsed) && typeof parsed.text === "string" && parsed.text.length > 0) {
      generatedComment = {
        schemaVersion: 1,
        gameId: "pgn-import",
        ply: fallbackPly,
        text: parsed.text,
      };
    } else {
      generatedComment = {
        schemaVersion: 1,
        gameId: "pgn-import",
        ply: fallbackPly,
        text: decoded,
      };
    }
  } catch {
    // Backward-compatible import for the initial text-only marker format.
    generatedComment = {
      schemaVersion: 1,
      gameId: "pgn-import",
      ply: fallbackPly,
      text: decoded,
    };
  }
  if (!generatedComment.text) return { comment: value };

  let before = value.slice(0, match.index);
  const after = value.slice(match.index + match[0].length);
  const visibleGeneratedText = `[Chess Reviewer: Bình luận tự động]\n${generatedComment.text}`;
  const generatedTail = `${visibleGeneratedText}\n\n`;
  const generatedWithSeparator = `\n\n${generatedTail}`;
  if (before.endsWith(generatedWithSeparator)) {
    before = before.slice(0, -generatedWithSeparator.length);
  } else if (before === generatedTail) {
    before = "";
  }
  const comment = `${before.endsWith("\n\n") ? before.slice(0, -2) : before}${after}`;
  return { comment, generatedComment };
}
