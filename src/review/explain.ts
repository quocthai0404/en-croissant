import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Score } from "@/bindings";
import type { ViewerSide } from "@/commentary/types";
import { makeSquare, parseSquare } from "chessops";
import { formatScore, normalizeScore } from "@/utils/score";
import type { ReviewEvidenceRecord } from "./types";

export interface ExplainPresentation {
  paragraphs: string[];
  boardPosition: "before" | "after";
  overlay: DrawShape[];
}

const PIECES: Record<ReviewEvidenceRecord["piece"], string> = {
  p: "tốt",
  n: "mã",
  b: "tượng",
  r: "xe",
  q: "hậu",
  k: "vua",
};

function sideName(side: "white" | "black"): string {
  return side === "white" ? "Trắng" : "Đen";
}

function sideReference(side: "white" | "black", viewer: ViewerSide): string {
  if (viewer === "neutral") return sideName(side);
  return side === viewer ? "bạn" : "đối thủ";
}

function sidePossessive(side: "white" | "black", viewer: ViewerSide): string {
  if (viewer === "neutral") return sideName(side);
  return side === viewer ? "của bạn" : "của đối thủ";
}

function sentenceStart(value: string): string {
  return value.replace(/^./u, (character) => character.toLocaleUpperCase("vi-VN"));
}

function moveLabel(ply: number, san: string): string {
  const number = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${number}.${san}` : `${number}...${san}`;
}

function moverScore(score: Score | null, side: "white" | "black"): string | null {
  if (!score) return null;
  if (score.value.type === "mate") {
    const value = side === "white" ? score.value.value : -score.value.value;
    return formatScore({ type: "mate", value });
  }
  if (score.value.type !== "cp") return null;
  return formatScore({ type: "cp", value: normalizeScore(score.value, side) });
}

function verifiedFacts(record: ReviewEvidenceRecord) {
  return record.facts.filter((fact) => fact.confidence === "verified");
}

function boardKey(square: string) {
  const parsed = parseSquare(square);
  return parsed === undefined ? undefined : makeSquare(parsed);
}

export function buildVerifiedExplainOverlay(record: ReviewEvidenceRecord): DrawShape[] {
  const shapes: DrawShape[] = [];
  const addArrow = (orig?: string, dest?: string) => {
    if (!orig || !dest || orig === dest || shapes.some((shape) => shape.orig === orig && shape.dest === dest)) return;
    const origin = boardKey(orig);
    const destination = boardKey(dest);
    if (origin && destination) shapes.push({ orig: origin, dest: destination, brush: "explain" });
  };
  const addSquare = (square?: string) => {
    if (!square || shapes.some((shape) => shape.orig === square && !shape.dest)) return;
    const key = boardKey(square);
    if (key) shapes.push({ orig: key, brush: "explainSquare" });
  };

  for (const fact of verifiedFacts(record)) {
    for (const square of fact.squares ?? []) addSquare(square);
    addSquare(fact.actor?.square);
    addSquare(fact.target?.square);
    if (fact.actor && fact.target && ["OPENED_ATTACK_LINE", "LEGAL_CAPTURE_AVAILABLE", "ENGINE_RECOMMENDED_CAPTURE", "CAPTURED_PIECE"].includes(fact.code)) {
      addArrow(fact.actor.square, fact.target.square);
    }
  }
  if (verifiedFacts(record).some((fact) => fact.code === "CAPTURED_PIECE")) {
    addArrow(record.playedMove.from, record.playedMove.to);
  }
  return shapes;
}

function factOverlay(record: ReviewEvidenceRecord): DrawShape[] {
  const shapes = buildVerifiedExplainOverlay(record);
  if (shapes.length > 0) return shapes;

  const bestMove = record.bestAlternativeBefore?.uci[0];
  if (typeof bestMove === "string" && bestMove.length >= 4) {
    const orig = boardKey(bestMove.slice(0, 2));
    const dest = boardKey(bestMove.slice(2, 4));
    if (orig && dest) return [{ orig, dest, brush: "explain" }];
  }
  return [];
}

export function buildExplainPresentation(
  record: ReviewEvidenceRecord,
  allRecords: ReviewEvidenceRecord[],
  viewer: ViewerSide,
): ExplainPresentation {
  const facts = verifiedFacts(record);
  const paragraphs: string[] = [];
  const openedLine = facts.find((fact) => fact.code === "OPENED_ATTACK_LINE");
  const captured = facts.find((fact) => fact.code === "CAPTURED_PIECE");
  const mate = facts.find((fact) => fact.code === "MATE");
  const mateAllowed = facts.find((fact) => fact.code === "ALLOWS_MATE");
  const legalCapture = facts.find((fact) => fact.code === "LEGAL_CAPTURE_AVAILABLE");
  const engineCapture = facts.find((fact) => fact.code === "ENGINE_RECOMMENDED_CAPTURE");
  let causeWasExplained = false;
  let boardPosition: "before" | "after" = captured ? "before" : "after";

  if (record.classification === "book" && record.opening) {
    paragraphs.push(
      `Vị trí sau nước này khớp cơ sở dữ liệu khai cuộc ${record.opening.name} (${record.opening.eco}); đây là nhận diện vị trí, không phải bảo chứng cho nước đi.`,
    );
  }

  if (record.event?.role === "exploitation" && record.event.result === "actual") {
    const target = facts.find((fact) => fact.code === "CAPTURED_PIECE")?.target;
    const captured = target ? ` bắt ${PIECES[target.type]} ${sidePossessive(target.side, viewer)} tại ${target.square} và` : "";
    paragraphs.push(
      `${moveLabel(record.mainlinePly, record.san)}${captured} tận dụng sơ hở do ${moveLabel(record.event.relatedPly, allRecords.find((item) => item.mainlinePly === record.event?.relatedPly)?.san ?? "nước trước")} để lại.`,
    );
    causeWasExplained = true;
  } else if (openedLine?.actor && openedLine.target && openedLine.blocker) {
    const actor = `${PIECES[openedLine.actor.type]} ${sidePossessive(openedLine.actor.side, viewer)}`;
    const target = `${PIECES[openedLine.target.type]} ${sidePossessive(openedLine.target.side, viewer)}`;
    const blocker = PIECES[openedLine.blocker.type];
    paragraphs.push(
      `${sentenceStart(sideReference(record.mover, viewer))} đi ${record.san}, đưa ${blocker} khỏi đường tấn công để ${actor} chĩa vào ${target} ở ${openedLine.target.square}.`,
    );
    if (record.event?.result === "actual") {
      const consequence = allRecords.find((item) => item.mainlinePly === record.event?.relatedPly);
      if (consequence) paragraphs.push(`${moveLabel(consequence.mainlinePly, consequence.san)} thực sự bắt quân đó; hãy kiểm tra đường tấn công trước khi dịch chuyển quân chắn.`);
    } else if (record.event?.result === "engine-recommended") {
      paragraphs.push(`Máy ưu tiên ${openedLine.evidenceMoves?.[0] ?? "nước bắt"}; đây là lựa chọn của engine, không phải kết luận rằng hơn quân là bắt buộc.`);
    } else if (openedLine.evidenceMoves?.[0]) {
      paragraphs.push(`Có nước bắt hợp lệ ${openedLine.evidenceMoves[0]}, nhưng điều đó chưa chứng minh quân sẽ mất hoặc bị bắt cưỡng bức.`);
    }
    causeWasExplained = true;
  } else if (captured?.target) {
    paragraphs.push(`${sentenceStart(sideReference(record.mover, viewer))} dùng ${PIECES[record.piece]} ${record.san} để bắt ${PIECES[captured.target.type]} ${sidePossessive(captured.target.side, viewer)} tại ${captured.target.square}.`);
    causeWasExplained = true;
  }

  if (mate) {
    paragraphs.push(`${record.san} là chiếu hết; ván cờ kết thúc ngay ở vị trí này.`);
    causeWasExplained = true;
  } else if (mateAllowed?.evidenceMoves?.[0]) {
    paragraphs.push(`Nước này cho phép đối thủ có đường chiếu hết ${mateAllowed.evidenceMoves[0]}; cần ưu tiên xử lý mối đe dọa đó.`);
    causeWasExplained = true;
  }

  if (!causeWasExplained && (engineCapture || legalCapture)?.target) {
    const fact = engineCapture ?? legalCapture!;
    const phrase = engineCapture ? "Máy đề xuất" : "Đối thủ có nước bắt hợp lệ";
    paragraphs.push(`${phrase} ${fact.evidenceMoves?.[0] ?? "một nước bắt"} vào ${PIECES[fact.target!.type]} tại ${fact.target!.square}. Nước bắt hợp lệ chưa đồng nghĩa với lợi thế vật chất bền vững.`);
    causeWasExplained = true;
  }

  if (!causeWasExplained) {
    const alternative = record.bestAlternativeBefore?.san[0];
    const playedScore = moverScore(record.afterScore, record.mover);
    const preferredScore = moverScore(record.bestAlternativeBefore?.score ?? record.beforeScore, record.mover);
    if (alternative && alternative !== record.san) {
      const delta = record.loss === null ? "" : ` (thay đổi khoảng ${record.loss.toFixed(1)} điểm phần trăm cơ hội thắng theo góc nhìn người đi)`;
      paragraphs.push(`Chưa có nguyên nhân chiến thuật đủ chắc để khẳng định. Máy ưu tiên ${alternative} thay vì ${record.san}${delta}.`);
      if (preferredScore && playedScore) paragraphs.push(`Đánh giá theo góc nhìn ${sideReference(record.mover, viewer)}: ${preferredScore} ở phương án máy chọn, ${playedScore} sau nước đã đi.`);
      const continuation = record.bestAlternativeBefore?.san.slice(0, 5).join(" ");
      if (continuation) paragraphs.push(`Phương án máy: ${continuation}. Đây là biến chính engine tìm được, không bảo đảm diễn biến sẽ bị ép buộc.`);
      boardPosition = "before";
    } else if (alternative === record.san) {
      paragraphs.push(`Chưa thấy nguyên nhân chiến thuật riêng biệt; ${record.san} trùng nước đầu tiên trong PV tốt nhất của máy ở độ sâu ${record.beforeDepth ?? "?"}.`);
      boardPosition = "before";
    } else {
      paragraphs.push("Bằng chứng cục bộ hiện chưa đủ để giải thích nguyên nhân của nước này. Hãy chạy lại Game Review với thời gian sâu hơn để có so sánh engine đáng tin cậy.");
    }
  }

  return { paragraphs, boardPosition, overlay: factOverlay(record) };
}
