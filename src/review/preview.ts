import type { DrawShape } from "@lichess-org/chessground/draw";
import { Chess, type Square } from "chess.js";
import { makeSquare, parseSquare } from "chessops";
import type { ReviewPv } from "./types";
import type { ReviewClassification } from "./classification";

export type ReviewPreviewLineType = "alternative" | "continuation";

export interface ReviewPreviewStep {
  fen: string;
  san: string;
  uci: string;
  from: string;
  to: string;
}

export interface ReviewPreviewLine {
  startFen: string;
  depth: number;
  steps: ReviewPreviewStep[];
}

/** A temporary, renderer-only board state. It never enters the game tree or PGN. */
export interface ReviewBoardPreview {
  activeTab: string;
  gameId: string;
  rootFen: string;
  mainlineIdentity: string;
  sourcePosition: number[];
  moveId: string;
  lineType: ReviewPreviewLineType | null;
  baseFen: string;
  lines: Partial<Record<ReviewPreviewLineType, ReviewPreviewLine>>;
  stepIndex: number;
  playing: boolean;
  factsOverlay: DrawShape[];
}

export type ReviewPreviewAction = "previous" | "next" | "replay" | "toggle";

export function choosePreferredPreviewLine(
  classification: ReviewClassification,
  alternative?: ReviewPreviewLine,
  continuation?: ReviewPreviewLine,
): ReviewPreviewLineType | null {
  const hasAlternative = Boolean(alternative?.steps.length);
  const hasContinuation = Boolean(continuation?.steps.length);
  if (["inaccuracy", "mistake", "blunder"].includes(classification) && hasAlternative) return "alternative";
  if (hasContinuation) return "continuation";
  return hasAlternative ? "alternative" : null;
}

export function updateReviewPreviewLine(
  preview: ReviewBoardPreview,
  lineType: ReviewPreviewLineType,
): ReviewBoardPreview {
  const line = preview.lines[lineType];
  return line?.steps.length
    ? { ...preview, lineType, stepIndex: 0, playing: false, baseFen: line.startFen }
    : preview;
}

export function updateReviewPreviewPlayback(
  preview: ReviewBoardPreview,
  action: ReviewPreviewAction,
): ReviewBoardPreview {
  if (!preview.lineType) return { ...preview, playing: false };
  const line = preview.lines[preview.lineType];
  if (!line?.steps.length) return { ...preview, playing: false };
  if (action === "replay") return { ...preview, stepIndex: 0, playing: false };
  if (action === "previous") {
    return { ...preview, stepIndex: Math.max(0, preview.stepIndex - 1), playing: false };
  }
  if (action === "next") {
    return { ...preview, stepIndex: Math.min(line.steps.length, preview.stepIndex + 1), playing: false };
  }
  const stepIndex = preview.stepIndex >= line.steps.length ? 0 : preview.stepIndex;
  return { ...preview, stepIndex, playing: !preview.playing };
}

export function isReviewPreviewCurrent(
  preview: ReviewBoardPreview,
  current: {
    activeTab: string;
    gameId: string;
    rootFen: string;
    mainlineIdentity: string;
    position: number[];
    availableMoveIds: string[];
  },
): boolean {
  return preview.activeTab === current.activeTab &&
    preview.gameId === current.gameId &&
    preview.rootFen === current.rootFen &&
    preview.mainlineIdentity === current.mainlineIdentity &&
    preview.sourcePosition.length === current.position.length &&
    preview.sourcePosition.every((index, depth) => index === current.position[depth]) &&
    current.availableMoveIds.includes(preview.moveId);
}

const UCI_PATTERN = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i;

/** Replay only the legal prefix of an engine PV; malformed tails are ignored. */
export function buildLegalPreviewLine(startFen: string, pv: ReviewPv | undefined): ReviewPreviewLine | undefined {
  if (!pv) return undefined;

  let chess: Chess;
  try {
    chess = new Chess(startFen);
  } catch {
    return undefined;
  }

  const steps: ReviewPreviewStep[] = [];
  const moveCount = Math.max(pv.uci.length, pv.san.length);
  for (let index = 0; index < moveCount; index += 1) {
    const uci = pv.uci[index] ?? "";
    const san = pv.san[index] ?? "";
    let move: ReturnType<Chess["move"]> | null = null;

    const parsedUci = UCI_PATTERN.exec(uci);
    if (parsedUci) {
      try {
        move = chess.move({
          from: parsedUci[1] as Square,
          to: parsedUci[2] as Square,
          ...(parsedUci[3] ? { promotion: parsedUci[3].toLowerCase() as "q" | "r" | "b" | "n" } : {}),
        });
      } catch {
        // An invalid UCI may still have a valid SAN representation.
      }
    }

    if (!move && san) {
      try {
        move = chess.move(san, { strict: false });
      } catch {
        // Stop at the first illegal or incomplete ply below.
      }
    }
    if (!move) break;

    steps.push({
      fen: chess.fen(),
      san: move.san,
      uci: `${move.from}${move.to}${move.promotion ?? ""}`,
      from: move.from,
      to: move.to,
    });
  }

  return { startFen, depth: pv.depth, steps };
}

export function getPreviewFen(preview: ReviewBoardPreview): string {
  const line = preview.lineType ? preview.lines[preview.lineType] : undefined;
  if (!line) return preview.baseFen;
  return line.steps[preview.stepIndex - 1]?.fen ?? line.startFen;
}

export function getPreviewCurrentStep(preview: ReviewBoardPreview): ReviewPreviewStep | undefined {
  if (preview.stepIndex <= 0 || !preview.lineType) return undefined;
  return preview.lines[preview.lineType]?.steps[preview.stepIndex - 1];
}

/** Temporary arrow for the current PV ply, independent from saved user shapes. */
export function getPreviewStepOverlay(step: ReviewPreviewStep | undefined): DrawShape[] {
  if (!step) return [];
  const orig = parseSquare(step.from);
  const dest = parseSquare(step.to);
  if (orig === undefined || dest === undefined) return [];
  const from = makeSquare(orig);
  const to = makeSquare(dest);
  return from && to ? [{ orig: from, dest: to, brush: "preview" }] : [];
}
