import { Chess, SQUARES, type PieceSymbol, type Square } from "chess.js";
import { moveMotifs, VALUE, type PieceRef } from "./vendor/patzer-tactics";
import type { ChessFact, FactPiece, GeneratedComment, MoveContext, Side } from "./types";
import type { TreeNode } from "@/utils/treeReducer";
import type { MoveAnalysis } from "@/bindings";
import { buildMoveContexts } from "./types";

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
          code: "PIECE_UNDER_ATTACK",
          subjectSide: mover,
          actor: factPiece(otherSide(mover), { type: attacker.type, square: capture.from }),
          target: factPiece(mover, piece),
          evidenceMoves: [capture.san],
          confidence: "verified",
          source: "adapter",
        });
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

const MOVE_ANNOTATIONS = ["!!", "!", "!?", "?!", "?", "??"] as const;

function moveLabel(context: MoveContext): string {
  const notation = context.mover === "black" ? `${context.moveNumber}...${context.san}` : `${context.moveNumber}.${context.san}`;
  return `${notation}${context.annotation && MOVE_ANNOTATIONS.includes(context.annotation as (typeof MOVE_ANNOTATIONS)[number]) ? context.annotation : ""}`;
}

function opponentReplyLabel(context: MoveContext, san: string): string {
  return context.mover === "white"
    ? `${context.moveNumber}...${san}`
    : `${context.moveNumber + 1}.${san}`;
}

function renderTemplate(context: MoveContext, facts: ChessFact[]): string {
  const label = moveLabel(context);
  const opponent = sideName(otherSide(context.mover));
  const mover = sideName(context.mover);
  const primary = [...facts]
    .filter((fact) => fact.confidence === "verified")
    .sort((a, b) => priority(a.code) - priority(b.code))[0];

  if (primary?.code === "ALLOWS_MATE") {
    return `Sau ${label}, ${opponent} có thể chơi ${primary.evidenceMoves?.[0] ?? "nước chiếu hết"} chiếu hết. Trước khi thực hiện nước đi, hãy kiểm tra các nước chiếu và đòn chiếu hết của đối thủ.`;
  }
  if (primary?.code === "MATE") return `${label} chiếu hết; ván cờ kết thúc.`;
  if (primary?.code === "OPENED_ATTACK_LINE" && primary.actor && primary.target) {
    const actorName = PIECE_NAMES[primary.actor.type];
    const targetName = PIECE_NAMES[primary.target.type];
    const blockerName = primary.blocker ? PIECE_NAMES[primary.blocker.type] : "quân";
    const blockerSquare = primary.blocker?.square ?? "ô cũ";
    const path = (primary.squares ?? []).join("–");
    const reply = primary.evidenceMoves?.[0]
      ? opponentReplyLabel(context, primary.evidenceMoves[0])
      : "nước bắt quân";
    return `${label} làm ${blockerName} ${mover} rời ${blockerSquare}, mở đường ${path} cho ${actorName} ${opponent}. ${targetName} ${mover} ở ${primary.target.square} nên ${opponent} có thể đáp ${reply} để ăn ${targetName}. Trước khi di chuyển quân chắn, hãy kiểm tra những đường tấn công mà nó đang che.`;
  }
  if (primary?.code === "PIECE_UNDER_ATTACK" && primary.target && primary.evidenceMoves?.[0]) {
    const target = PIECE_NAMES[primary.target.type];
    const reply = opponentReplyLabel(context, primary.evidenceMoves[0]);
    return `Sau ${label}, ${opponent} có thể chơi ${reply} để bắt ${target} ${mover} ở ${primary.target.square}. Kiểm tra xem quân này có được bảo vệ hoặc có thể đổi lại không.`;
  }
  if (primary?.code === "CAPTURED_PIECE" && primary.target) {
    const target = PIECE_NAMES[primary.target.type];
    if (primary.target.type === "q" || primary.target.type === "r") {
      return `${label} ăn ${target} ${opponent} ở ${primary.target.square}.`;
    }
    return `${label} ăn ${target} của ${opponent}.`;
  }
  if (primary?.code === "CHECK") return `${label} chiếu vua ${opponent}; hãy kiểm tra các nước đáp bắt buộc.`;
  if (primary?.code === "CASTLING") return `${label} nhập thành, chuyển vua và xe bằng một nước đi.`;
  if (primary?.code === "DEVELOPMENT" && primary.actor) {
    return `${label} đưa ${PIECE_NAMES[primary.actor.type]} ra khỏi hàng xuất phát.`;
  }

  if (["??", "?", "?!"].includes(context.annotation ?? "") && context.bestMoveSan) {
    const assessment = context.annotation === "??" ? "rất yếu" : "chưa chính xác";
    return `Engine hiện tại đánh giá ${label} là nước ${assessment}; phương án được đề xuất là ${context.bestMoveSan}. Chưa đủ dữ kiện để khẳng định một nguyên nhân chiến thuật cụ thể.`;
  }
  return `${label} tiếp tục ván cờ; hiện chưa có dữ kiện đủ chắc để giải thích mục tiêu sâu hơn.`;
}

function priority(code: ChessFact["code"]): number {
  switch (code) {
    case "MATE":
      return 0;
    case "ALLOWS_MATE":
      return 1;
    case "OPENED_ATTACK_LINE":
      return 2;
    case "PIECE_UNDER_ATTACK":
      return 3;
    case "CAPTURED_PIECE":
      return 4;
    case "CHECK":
      return 5;
    case "CASTLING":
      return 6;
    case "DEVELOPMENT":
      return 7;
    default:
      return 100;
  }
}

export function generateCommentary(
  root: TreeNode,
  gameId: string,
  analysis: MoveAnalysis[],
): GeneratedComment[] {
  const contexts = buildMoveContexts(root, gameId, analysis);
  return contexts.map((context) => {
    const facts = getChessFacts(context);
    return {
      mainlinePly: context.mainlinePly,
      position: context.position,
      text: renderTemplate(context, facts),
      facts,
    };
  });
}
