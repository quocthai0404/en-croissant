import type { BestMoves, MoveAnalysis } from "@/bindings";
import { getMoverWinChanceLoss, classifyMove } from "./classification";
import type { ReviewEvidenceRecord, ReviewEvidenceSnapshot, ReviewPv } from "./types";
import { getReviewFactsForGame } from "@/commentary/service";
import { getMainLine } from "@/utils/chess";
import type { TreeNode } from "@/utils/treeReducer";
import { Chess } from "chess.js";

export interface OpeningMembership {
  eco: string;
  name: string;
}

function summarizePv(line: BestMoves | null | undefined): ReviewPv | undefined {
  if (!line || line.sanMoves.length === 0) return undefined;
  return {
    san: line.sanMoves.slice(0, 8),
    uci: line.uciMoves.slice(0, 8),
    depth: line.depth,
    score: line.score,
  };
}

function getNextPlyVerifiedSacrifice(
  current: ReturnType<typeof getReviewFactsForGame>[number],
  next: ReturnType<typeof getReviewFactsForGame>[number] | undefined,
): boolean {
  if (!next || current.context.bestReplyAfter?.sanMoves[0] !== next.context.san) return false;
  if ((current.context.bestReplyAfter?.depth ?? 0) < 12 || (next.context.bestReplyAfter?.depth ?? 0) < 12) {
    return false;
  }
  try {
    const before = new Chess(current.context.fenBefore);
    const played = before.move(current.context.san, { strict: false });
    const after = new Chess(current.context.fenAfter);
    const reply = after.move(next.context.san, { strict: false });
    const capturedPiece = next.facts.some(
      (fact) =>
        fact.code === "CAPTURED_PIECE" &&
        fact.target?.side === current.context.mover &&
        fact.target.square === played.to,
    );
    const loss = getMoverWinChanceLoss(
      current.context.scoreBefore?.value,
      next.context.scoreAfter?.value,
      current.context.mover,
    );
    return Boolean(
      reply.isCapture() && reply.to === played.to && capturedPiece && loss !== null && loss <= 1,
    );
  } catch {
    return false;
  }
}

export function buildReviewEvidence(
  root: TreeNode,
  gameId: string,
  analysis: MoveAnalysis[],
  openings: Array<OpeningMembership | null>,
): ReviewEvidenceSnapshot {
  const reviewed = getReviewFactsForGame(root, gameId, analysis);
  const records: ReviewEvidenceRecord[] = reviewed.map(({ context, facts, event }, index) => {
    const before = context.bestAlternativeBefore;
    const after = context.bestReplyAfter;
    const opening = openings[index] ?? undefined;
    const boardBefore = new Chess(context.fenBefore);
    const playedMove = boardBefore.move(context.san, { strict: false });
    const verifiedSacrifice = getNextPlyVerifiedSacrifice(reviewed[index]!, reviewed[index + 1]);
    const judged = classifyMove({
      mover: context.mover,
      san: context.san,
      scoreBefore: context.scoreBefore?.value,
      scoreAfter: context.scoreAfter?.value,
      depthBefore: before?.depth,
      depthAfter: after?.depth,
      bestAlternativeSan: before?.sanMoves[0],
      exactOpeningMatch: Boolean(opening),
      verifiedSacrifice,
    });
    return {
      moveId: `${gameId}:${context.mainlinePly}`,
      mainlinePly: context.mainlinePly,
      position: context.position,
      san: context.san,
      playedMove: { from: playedMove.from, to: playedMove.to },
      piece: playedMove.piece,
      mover: context.mover,
      beforeScore: context.scoreBefore,
      afterScore: context.scoreAfter,
      beforeDepth: before?.depth ?? null,
      afterDepth: after?.depth ?? null,
      classification: judged.classification,
      loss: judged.loss,
      facts,
      ...(event ? { event } : {}),
      ...(opening ? { opening } : {}),
      ...(summarizePv(before) ? { bestAlternativeBefore: summarizePv(before)! } : {}),
      ...(summarizePv(after) ? { bestReplyAfter: summarizePv(after)! } : {}),
    };
  });

  const moves = getMainLine(root);
  return {
    schemaVersion: 1,
    gameId,
    rootFen: root.fen,
    mainlineIdentity: moves.join(" "),
    createdAt: Date.now(),
    records,
  };
}

export function isReviewEvidenceCurrent(
  evidence: ReviewEvidenceSnapshot | undefined,
  rootFen: string,
  moves: string[],
): evidence is ReviewEvidenceSnapshot {
  return Boolean(
    evidence &&
      evidence.schemaVersion === 1 &&
      evidence.rootFen === rootFen &&
      evidence.mainlineIdentity === moves.join(" "),
  );
}
