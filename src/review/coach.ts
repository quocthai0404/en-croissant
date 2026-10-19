import type { ReviewClassification } from "./classification";
import { classificationLabel } from "./classification";
import type { ReviewEvidenceRecord } from "./types";
import { formatScore } from "@/utils/score";

const PIECE_GLYPHS: Record<ReviewEvidenceRecord["piece"], { white: string; black: string }> = {
  p: { white: "♙", black: "♟" },
  n: { white: "♘", black: "♞" },
  b: { white: "♗", black: "♝" },
  r: { white: "♖", black: "♜" },
  q: { white: "♕", black: "♛" },
  k: { white: "♔", black: "♚" },
};

const COACH_PHRASES: Record<ReviewClassification, string> = {
  book: "nước theo lý thuyết khai cuộc",
  brilliant: "nước xuất sắc",
  best: "nước tốt nhất",
  excellent: "nước rất tốt",
  good: "nước tốt",
  inaccuracy: "nước chưa chính xác",
  mistake: "một sai lầm",
  blunder: "một sai lầm nghiêm trọng",
  unclassified: "chưa đủ dữ liệu để xếp loại",
};

export interface MoveCoachSummary {
  pieceGlyph: string;
  move: string;
  moveNumber: string;
  classification: string;
  phrase: string;
  evaluation: string;
}

export interface ReviewRowViewportBounds {
  top: number;
  bottom: number;
}

/** Return a new scrollTop that reveals a row by scrolling only its list viewport. */
export function getReviewRowScrollTop(
  currentScrollTop: number,
  viewport: ReviewRowViewportBounds,
  row: ReviewRowViewportBounds,
): number {
  if (row.top < viewport.top) return currentScrollTop + row.top - viewport.top;
  if (row.bottom > viewport.bottom) return currentScrollTop + row.bottom - viewport.bottom;
  return currentScrollTop;
}

export function buildMoveCoachSummary(record: ReviewEvidenceRecord): MoveCoachSummary {
  const moveNumber = Math.ceil(record.mainlinePly / 2);
  return {
    pieceGlyph: PIECE_GLYPHS[record.piece][record.mover],
    move: record.san,
    moveNumber: record.mainlinePly % 2 ? `${moveNumber}.` : `${moveNumber}...`,
    classification: classificationLabel(record.classification),
    phrase: COACH_PHRASES[record.classification],
    evaluation: record.afterScore ? formatScore(record.afterScore.value) : "–",
  };
}

export function findReviewRecordAtPosition(
  records: ReviewEvidenceRecord[],
  position: number[],
): ReviewEvidenceRecord | undefined {
  return records.find((record) =>
    record.position.length === position.length &&
    record.position.every((index, depth) => index === position[depth]),
  );
}
