import { Chess, SQUARES, type PieceSymbol, type Square } from "chess.js";
import { moveMotifs, VALUE, type PieceRef } from "./vendor/patzer-tactics";
import type {
  ChessFact,
  CommentaryEvent,
  CommentaryIntent,
  CommentaryPlan,
  FactPiece,
  GeneratedComment,
  MoveContext,
  Side,
  ViewerSide,
} from "./types";
import { treeIterator } from "@/utils/treeReducer";
import type { GameHeaders, GeneratedCommentMetadata, TreeNode } from "@/utils/treeReducer";
import type { MoveAnalysis } from "@/bindings";
import { buildMoveContexts } from "./types";
import type { CommentaryPerspective } from "./perspective";
import { resolveViewerSide } from "./perspective";
import type { Session } from "@/utils/session";

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "tốt",
  n: "mã",
  b: "tượng",
  r: "xe",
  q: "hậu",
  k: "vua",
};

const sideName = (side: Side) => (side === "white" ? "Trắng" : "Đen");
const otherSide = (side: Side): Side => (side === "white" ? "black" : "white");

function factPiece(side: Side, piece: PieceRef): FactPiece {
  return { side, type: piece.type, square: piece.square };
}

function boardSquares(chess: Chess): Square[] {
  return SQUARES.filter((square) => chess.get(square) !== undefined);
}

function openedAttackLine(context: MoveContext, factIndex: number): ChessFact | null {
  try {
    const before = new Chess(context.fenBefore);
    const after = new Chess(context.fenBefore);
    const played = after.move(context.san, { strict: false });
    const movingPiece = before.get(played.from);
    if (!movingPiece) return null;

    const targets = boardSquares(after)
      .map((square) => ({ square, piece: after.get(square)! }))
      .filter(({ piece }) => piece.color === (context.mover === "white" ? "w" : "b"))
      .sort((a, b) => VALUE[b.piece.type] - VALUE[a.piece.type]);

    for (const actorSquare of boardSquares(after)) {
      const actor = after.get(actorSquare)!;
      if (
        actor.color === (context.mover === "white" ? "w" : "b") ||
        !["b", "r", "q"].includes(actor.type)
      ) {
        continue;
      }

      for (const target of targets) {
        if (target.piece.type !== "q" && target.piece.type !== "r") continue;
        const fromFile = actorSquare.charCodeAt(0) - 97;
        const fromRank = Number(actorSquare[1]);
        const toFile = target.square.charCodeAt(0) - 97;
        const toRank = Number(target.square[1]);
        const fileDelta = toFile - fromFile;
        const rankDelta = toRank - fromRank;
        const diagonal = Math.abs(fileDelta) === Math.abs(rankDelta);
        const straight = fileDelta === 0 || rankDelta === 0;
        if (!diagonal && !straight) continue;
        if (actor.type === "b" && !diagonal) continue;
        if (actor.type === "r" && !straight) continue;

        const fileStep = Math.sign(fileDelta);
        const rankStep = Math.sign(rankDelta);
        const ray: Square[] = [];
        let file = fromFile + fileStep;
        let rank = fromRank + rankStep;
        while (file !== toFile || rank !== toRank) {
          ray.push(`${String.fromCharCode(97 + file)}${rank}` as Square);
          file += fileStep;
          rank += rankStep;
        }
        if (!ray.includes(played.from)) continue;
        if (ray.some((square) => after.get(square) !== undefined)) continue;
        if (ray.some((square) => square !== played.from && before.get(square) !== undefined)) continue;

        const reply = after
          .moves({ square: actorSquare, verbose: true })
          .find((candidate) => candidate.to === target.square && candidate.isCapture());
        if (!reply) continue;

        return {
          id: `${context.mainlinePly}:opened-line:${factIndex}`,
          code: "OPENED_ATTACK_LINE",
          subjectSide: context.mover,
          actor: {
            side: otherSide(context.mover),
            type: actor.type,
            square: actorSquare,
          },
          blocker: {
            side: context.mover,
            type: movingPiece.type,
            square: played.from,
          },
          target: {
            side: context.mover,
            type: target.piece.type,
            square: target.square,
          },
          squares: [actorSquare, ...ray, target.square],
          evidenceMoves: [reply.san],
          confidence: "verified",
          source: "adapter",
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function legalCaptureOf(context: MoveContext, targetSquare: Square): { from: Square; san: string } | null {
  try {
    const after = new Chess(context.fenBefore);
    after.move(context.san, { strict: false });
    const capture = after
      .moves({ verbose: true })
      .find((candidate) => candidate.to === targetSquare && candidate.isCapture());
    return capture ? { from: capture.from, san: capture.san } : null;
  } catch {
    return null;
  }
}

export function getChessFacts(context: MoveContext): ChessFact[] {
  const facts: ChessFact[] = [];
  const motifs = moveMotifs(context.fenBefore, context.san);
  if (!motifs) return facts;

  const mover = context.mover;
  if (motifs.captured) {
    facts.push({
      id: `${context.mainlinePly}:capture`,
      code: "CAPTURED_PIECE",
      subjectSide: mover,
      actor: factPiece(mover, motifs.piece),
      target: factPiece(otherSide(mover), motifs.captured),
      confidence: "verified",
      source: "patzer",
    });
  }
  if (motifs.mate) {
    facts.push({
      id: `${context.mainlinePly}:mate`,
      code: "MATE",
      subjectSide: mover,
      evidenceMoves: [motifs.san],
      confidence: "verified",
      source: "patzer",
    });
  } else if (motifs.check) {
    facts.push({
      id: `${context.mainlinePly}:check`,
      code: "CHECK",
      subjectSide: mover,
      evidenceMoves: [motifs.san],
      confidence: "verified",
      source: "patzer",
    });
  }
  if (motifs.allowsMate) {
    facts.push({
      id: `${context.mainlinePly}:allows-mate`,
      code: "ALLOWS_MATE",
      subjectSide: mover,
      evidenceMoves: [motifs.allowsMate],
      confidence: "verified",
      source: "patzer",
    });
  }
  if (motifs.castles) {
    facts.push({
      id: `${context.mainlinePly}:castling`,
      code: "CASTLING",
      subjectSide: mover,
      confidence: "verified",
      source: "patzer",
    });
  }
  if (motifs.develops) {
    facts.push({
      id: `${context.mainlinePly}:development`,
      code: "DEVELOPMENT",
      subjectSide: mover,
      actor: factPiece(mover, { type: motifs.piece.type, square: motifs.piece.square }),
      confidence: "verified",
      source: "patzer",
    });
  }
  if (motifs.fork.length > 0) {
    facts.push({
      id: `${context.mainlinePly}:fork-candidate`,
      code: "FORK_CANDIDATE",
      subjectSide: mover,
      actor: factPiece(mover, motifs.piece),
      target: factPiece(otherSide(mover), motifs.fork[0]!),
      confidence: "heuristic",
      source: "patzer",
    });
  }
  for (const piece of motifs.hangs) {
    const capture = legalCaptureOf(context, piece.square);
    if (capture) {
      const after = new Chess(context.fenBefore);
      after.move(context.san, { strict: false });
      const attacker = after.get(capture.from);
      if (attacker) {
        facts.push({
          id: `${context.mainlinePly}:attacked:${piece.square}`,
          code: "LEGAL_CAPTURE_AVAILABLE",
          subjectSide: mover,
          actor: factPiece(otherSide(mover), { type: attacker.type, square: capture.from }),
          target: factPiece(mover, piece),
          evidenceMoves: [capture.san],
          confidence: "verified",
          source: "adapter",
        });
        if (context.bestReplyAfter?.sanMoves[0] === capture.san) {
          facts.push({
            id: `${context.mainlinePly}:engine-recommends-capture:${piece.square}`,
            code: "ENGINE_RECOMMENDED_CAPTURE",
            subjectSide: mover,
            actor: factPiece(otherSide(mover), { type: attacker.type, square: capture.from }),
            target: factPiece(mover, piece),
            evidenceMoves: [capture.san],
            confidence: "verified",
            source: "adapter",
          });
        }
        continue;
      }
    }
    facts.push({
      id: `${context.mainlinePly}:hanging:${piece.square}`,
      code: "HANGING_PIECE_CANDIDATE",
      subjectSide: mover,
      target: factPiece(mover, piece),
      confidence: "heuristic",
      source: "patzer",
    });
  }

  const openedLine = openedAttackLine(context, 0);
  if (openedLine) facts.push(openedLine);
  return facts;
}

function hasSameTarget(first: ChessFact, second: ChessFact): boolean {
  return Boolean(
    first.target &&
      second.target &&
      first.target.side === second.target.side &&
      first.target.type === second.target.type &&
      first.target.square === second.target.square,
  );
}

function planTacticalEvents(
  contexts: MoveContext[],
  factsByContext: ChessFact[][],
): Map<number, CommentaryEvent> {
  const events = new Map<number, CommentaryEvent>();

  contexts.forEach((context, index) => {
    const facts = factsByContext[index] ?? [];
    const exposure =
      facts.find((fact) => fact.code === "OPENED_ATTACK_LINE" && fact.target) ??
      facts.find((fact) => fact.code === "LEGAL_CAPTURE_AVAILABLE" && fact.target);
    if (!exposure?.target) return;

    const actualCapture = (factsByContext[index + 1] ?? []).find(
      (fact) => fact.code === "CAPTURED_PIECE" && hasSameTarget(exposure, fact),
    );
    const engineCapture = facts.find(
      (fact) => fact.code === "ENGINE_RECOMMENDED_CAPTURE" && hasSameTarget(exposure, fact),
    );
    const legalCapture = facts.find(
      (fact) => fact.code === "LEGAL_CAPTURE_AVAILABLE" && hasSameTarget(exposure, fact),
    );
    const next = contexts[index + 1];
    const eventId = `${context.gameId}:capture:${context.mainlinePly}:${exposure.target.square}`;

    if (actualCapture && next) {
      events.set(context.mainlinePly, {
        id: eventId,
        role: "cause",
        relatedPly: next.mainlinePly,
        result: "actual",
      });
      events.set(next.mainlinePly, {
        id: eventId,
        role: "exploitation",
        relatedPly: context.mainlinePly,
        result: "actual",
      });
    } else if (engineCapture) {
      events.set(context.mainlinePly, {
        id: eventId,
        role: "cause",
        relatedPly: context.mainlinePly + 1,
        result: "engine-recommended",
      });
    } else if (legalCapture) {
      events.set(context.mainlinePly, {
        id: eventId,
        role: "cause",
        relatedPly: context.mainlinePly + 1,
        result: "legal-capture",
      });
    }
  });

  return events;
}

function chooseIntent(
  facts: ChessFact[],
  event: CommentaryEvent | undefined,
  openingName: string | undefined,
): CommentaryIntent | null {
  if (facts.some((fact) => fact.code === "MATE")) return "mate";
  if (facts.some((fact) => fact.code === "ALLOWS_MATE")) return "mate-threat";
  if (event?.role === "exploitation") return "capture";
  if (facts.some((fact) => fact.code === "OPENED_ATTACK_LINE")) return "opened-attack";
  if (
    facts.some(
      (fact) =>
        fact.code === "ENGINE_RECOMMENDED_CAPTURE" || fact.code === "LEGAL_CAPTURE_AVAILABLE",
    )
  ) {
    return "capture-opportunity";
  }
  if (
    facts.some(
      (fact) =>
        fact.code === "CAPTURED_PIECE" && fact.target && ["n", "b", "r", "q"].includes(fact.target.type),
    )
  ) {
    return "capture";
  }
  if (facts.some((fact) => fact.code === "CHECK")) return "check";
  if (facts.some((fact) => fact.code === "CASTLING")) return "castling";
  if (facts.some((fact) => fact.code === "DEVELOPMENT")) return "development";
  if (openingName) return "opening";
  return null;
}

function engineSummary(
  line: MoveContext["bestAlternativeBefore"],
): { san: string; depth: number; score: MoveContext["scoreBefore"] & {} } | undefined {
  const san = line?.sanMoves[0];
  return san && line ? { san, depth: line.depth, score: line.score } : undefined;
}

function makePlan(
  context: MoveContext,
  facts: ChessFact[],
  intent: CommentaryIntent,
  event: CommentaryEvent | undefined,
  openingName: string | undefined,
): CommentaryPlan {
  const bestAlternativeBefore = engineSummary(context.bestAlternativeBefore);
  const bestReplyAfter = engineSummary(context.bestReplyAfter);
  return {
    moveId: `${context.gameId}:${context.mainlinePly}`,
    gameId: context.gameId,
    mainlinePly: context.mainlinePly,
    mover: context.mover,
    moveNumber: context.moveNumber,
    san: context.san,
    intent,
    facts,
    ...(event ? { event } : {}),
    ...(openingName ? { openingName } : {}),
    ...(bestAlternativeBefore || bestReplyAfter
      ? {
          engineEvidence: {
            ...(bestAlternativeBefore ? { bestAlternativeBefore } : {}),
            ...(bestReplyAfter ? { bestReplyAfter } : {}),
          },
        }
      : {}),
  };
}

function sideReference(side: Side, viewerSide: ViewerSide): string {
  if (viewerSide === "neutral") return sideName(side);
  return side === viewerSide ? "bạn" : "đối thủ";
}

function capitalizeFirst(value: string): string {
  return value.replace(/^./u, (letter) => letter.toLocaleUpperCase("vi-VN"));
}

function sidePossessive(side: Side, viewerSide: ViewerSide): string {
  if (viewerSide === "neutral") return sideName(side);
  return side === viewerSide ? "của bạn" : "của đối thủ";
}

function openingIntroduction(openingName: string): string {
  const normalized = openingName.toLowerCase();
  if (normalized.includes("scandinavian defense")) {
    return "Ván này theo Phòng thủ Scandinavia: Đen phản công trung tâm ngay từ đầu. Sau loạt đổi tốt, hãy phát triển quân nhẹ trước khi tìm cách ăn thêm tốt.";
  }
  return "";
}

function renderOpenedAttack(plan: CommentaryPlan, viewerSide: ViewerSide): string {
  const fact = plan.facts.find((candidate) => candidate.code === "OPENED_ATTACK_LINE");
  if (!fact?.actor || !fact.target) return "";

  const actorName = PIECE_NAMES[fact.actor.type];
  const blockerName = fact.blocker ? PIECE_NAMES[fact.blocker.type] : "quân";
  const targetName = PIECE_NAMES[fact.target.type];
  const mover = sideReference(plan.mover, viewerSide);
  const actorDescription =
    viewerSide === "neutral"
      ? `${actorName} ${sideName(fact.actor.side)}`
      : `${actorName} ${sidePossessive(fact.actor.side, viewerSide)}`;
  const targetPossessive = sidePossessive(fact.target.side, viewerSide);
  const firstSentence =
    viewerSide === "neutral"
      ? `${sideName(plan.mover)} đẩy ${blockerName} khỏi đường chéo do ${actorDescription} kiểm soát, khiến ${targetName} ${sideName(fact.target.side)} lọt vào tầm bắt.`
      : `${mover === "bạn" ? "Bạn" : "Đối thủ"} đẩy ${blockerName} khỏi đường chéo do ${actorDescription} kiểm soát, khiến ${targetName} ${targetPossessive} lọt vào tầm bắt.`;

  if (plan.event?.result === "actual") {
    return `${firstSentence} Trước khi đẩy quân chắn, hãy kiểm tra đường tấn công nó đang che.`;
  }

  const engineRecommended = plan.event?.result === "engine-recommended";
  const opportunity = engineRecommended
    ? `Máy phân tích ưu tiên nước bắt ${targetName} ${targetPossessive} bằng ${actorName}; hãy kiểm tra xem quân bắt có thể bị đổi lại không.`
    : `${actorDescription} có nước bắt ${targetName} ${targetPossessive} hợp lệ ngay; hãy kiểm tra khả năng đổi lại trước khi kết luận sẽ hơn quân.`;
  return `${firstSentence} ${opportunity} Trước khi đẩy quân chắn, hãy kiểm tra đường tấn công nó đang che.`;
}

function renderCaptureOpportunity(plan: CommentaryPlan, viewerSide: ViewerSide): string {
  const fact = plan.facts.find(
    (candidate) =>
      candidate.code === "ENGINE_RECOMMENDED_CAPTURE" ||
      candidate.code === "LEGAL_CAPTURE_AVAILABLE",
  );
  if (!fact?.actor || !fact.target) return "";
  const targetName = PIECE_NAMES[fact.target.type];
  const actorName = PIECE_NAMES[fact.actor.type];
  const targetPossessive = sidePossessive(fact.target.side, viewerSide);
  if (fact.code === "ENGINE_RECOMMENDED_CAPTURE") {
    return `Máy phân tích ưu tiên nước bắt ${targetName} ${targetPossessive} bằng ${actorName}. Hãy kiểm tra khả năng đổi lại trước khi kết luận sẽ hơn quân.`;
  }
  return `${capitalizeFirst(`${actorName} ${sidePossessive(fact.actor.side, viewerSide)}`)} có nước bắt ${targetName} ${targetPossessive} hợp lệ ngay. Hãy kiểm tra khả năng đổi lại trước khi đánh giá đây là lợi thế vật chất.`;
}

function renderCapture(plan: CommentaryPlan, viewerSide: ViewerSide): string {
  const fact = plan.facts.find((candidate) => candidate.code === "CAPTURED_PIECE");
  if (!fact?.target) return "";
  const targetName = PIECE_NAMES[fact.target.type];
  const mover = sideReference(plan.mover, viewerSide);
  if (plan.event?.role === "exploitation") {
    if (viewerSide === "neutral") {
      return `${sideName(plan.mover)} tận dụng sơ hở vừa mở ra để bắt ${targetName} ${sideName(fact.target.side)}.`;
    }
    return mover === "bạn"
      ? `Bạn tận dụng sơ hở vừa tạo ra và bắt được ${targetName} ${sidePossessive(fact.target.side, viewerSide)}.`
      : `Đối thủ tận dụng sơ hở vừa mở ra để bắt ${targetName} ${sidePossessive(fact.target.side, viewerSide)}.`;
  }
  return `${mover === "bạn" ? "Bạn" : mover} bắt được ${targetName} ${sidePossessive(fact.target.side, viewerSide)}; hãy kiểm tra xem quân vừa bắt có bị đổi lại không.`;
}

export function renderCommentaryPlan(plan: CommentaryPlan, viewerSide: ViewerSide): string {
  if (plan.intent === "mate") {
    return `${capitalizeFirst(sideReference(plan.mover, viewerSide))} chiếu hết, ván cờ kết thúc.`;
  }
  if (plan.intent === "mate-threat") {
    const opponent = sideReference(otherSide(plan.mover), viewerSide);
    return `${capitalizeFirst(sideReference(plan.mover, viewerSide))} vừa để ${opponent} có cơ hội chiếu hết ngay. Trước mỗi nước đi, hãy kiểm tra các nước chiếu của đối thủ.`;
  }
  if (plan.intent === "opened-attack") return renderOpenedAttack(plan, viewerSide);
  if (plan.intent === "capture-opportunity") return renderCaptureOpportunity(plan, viewerSide);
  if (plan.intent === "capture") return renderCapture(plan, viewerSide);
  if (plan.intent === "check") {
    return `${capitalizeFirst(sideReference(plan.mover, viewerSide))} chiếu vua ${sideReference(otherSide(plan.mover), viewerSide)}; hãy kiểm tra các cách đỡ chiếu và những quân đang bị lộ.`;
  }
  if (plan.intent === "castling") {
    return `${capitalizeFirst(sideReference(plan.mover, viewerSide))} nhập thành, đưa vua về phía cánh và đưa xe tham gia ván đấu.`;
  }
  if (plan.intent === "development") {
    const fact = plan.facts.find((candidate) => candidate.code === "DEVELOPMENT");
    if (!fact?.actor) return "";
    return `${capitalizeFirst(sideReference(plan.mover, viewerSide))} đưa ${PIECE_NAMES[fact.actor.type]} ra khỏi vị trí ban đầu, thêm một quân vào cuộc.`;
  }
  if (plan.intent === "opening" && plan.openingName) {
    return openingIntroduction(plan.openingName);
  }
  return "";
}

export function getCommentsForPerspective(
  root: TreeNode,
  perspective: CommentaryPerspective,
  headers: GameHeaders,
  sessions: Session[],
): {
  position: number[];
  comment: Extract<GeneratedCommentMetadata, { schemaVersion: 2 }>;
}[] {
  const viewerSide = resolveViewerSide(perspective, headers, sessions);
  const comments: {
    position: number[];
    comment: Extract<GeneratedCommentMetadata, { schemaVersion: 2 }>;
  }[] = [];

  for (const { position, node } of treeIterator(root)) {
    const existing = node.generatedComment;
    if (!existing || existing.schemaVersion !== 2) continue;
    const text = renderCommentaryPlan(existing.plan, viewerSide);
    if (!text) continue;
    comments.push({ position, comment: { ...existing, text } });
  }

  return comments;
}

export function generateCommentary(
  root: TreeNode,
  gameId: string,
  analysis: MoveAnalysis[],
  options: { openingName?: string; viewerSide?: ViewerSide } = {},
): GeneratedComment[] {
  const contexts = buildMoveContexts(root, gameId, analysis);
  const factsByContext = contexts.map((context) => getChessFacts(context));
  const events = planTacticalEvents(contexts, factsByContext);
  const viewerSide = options.viewerSide ?? "neutral";
  const comments: GeneratedComment[] = [];

  contexts.forEach((context, index) => {
    const facts = (factsByContext[index] ?? []).filter((fact) => fact.confidence === "verified");
    const event = events.get(context.mainlinePly);
    const openingName = index === 0 ? options.openingName : undefined;
    const intent = chooseIntent(facts, event, openingName);
    if (!intent) return;

    const plan = makePlan(context, facts, intent, event, openingName);
    const text = renderCommentaryPlan(plan, viewerSide);
    if (!text) return;
    comments.push({
      mainlinePly: context.mainlinePly,
      position: context.position,
      text,
      facts,
      plan,
    });
  });

  return comments;
}
