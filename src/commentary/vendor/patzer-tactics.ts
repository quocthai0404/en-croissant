/*
 * Selected source from Patzer's server/src/coach/tactics.ts.
 * Copyright (c) 2026 the Patzer contributors; licensed under MIT.
 * The source is used as a deterministic motif candidate generator. Consumers
 * must verify tactical claims before presenting them as facts.
 * Upstream: https://github.com/SikamikanikoBG/patzer
 */
import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";

export const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

export interface PieceRef {
  type: PieceSymbol;
  square: Square;
}

const other = (color: Color): Color => (color === "w" ? "b" : "w");

function pieces(chess: Chess, color: Color): PieceRef[] {
  const found: PieceRef[] = [];
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece && piece.color === color) found.push({ type: piece.type, square: piece.square });
    }
  }
  return found;
}

/** Candidate pieces attacked by a cheaper unit or left undefended. */
export function hangingPieces(chess: Chess, color: Color): PieceRef[] {
  const found: PieceRef[] = [];
  for (const piece of pieces(chess, color)) {
    if (piece.type === "k") continue;
    const attackers = chess.attackers(piece.square, other(color));
    if (attackers.length === 0) continue;
    const defenders = chess.attackers(piece.square, color);
    const cheapest = Math.min(...attackers.map((square) => VALUE[chess.get(square)!.type]));
    if (defenders.length === 0 || cheapest < VALUE[piece.type]) found.push(piece);
  }
  return found.sort((a, b) => VALUE[b.type] - VALUE[a.type]);
}

/** A legal mate-in-one SAN move for the side to move, if one exists. */
export function mateInOne(chess: Chess): string | null {
  return chess.moves().find((san) => san.endsWith("#")) ?? null;
}

function passTurn(chess: Chess): Chess | null {
  if (chess.inCheck()) return null;
  const parts = chess.fen().split(" ");
  parts[1] = parts[1] === "w" ? "b" : "w";
  parts[3] = "-";
  try {
    return new Chess(parts.join(" "));
  } catch {
    return null;
  }
}

export interface MoveMotifs {
  san: string;
  piece: PieceRef;
  mate: boolean;
  check: boolean;
  castles: boolean;
  promotes: boolean;
  develops: boolean;
  captured: PieceRef | null;
  fork: PieceRef[];
  hangs: PieceRef[];
  saves: PieceRef[];
  threatens: PieceRef[];
  allowsMate: string | null;
  stopsMate: boolean;
  threatensMate: boolean;
}

/** What the played move does for its mover. Null means invalid FEN or SAN. */
export function moveMotifs(fenBefore: string, san: string): MoveMotifs | null {
  let before: Chess;
  try {
    before = new Chess(fenBefore);
  } catch {
    return null;
  }

  const me = before.turn();
  const them = other(me);
  const hangingBefore = hangingPieces(before, me);
  const theirHangingBefore = hangingPieces(before, them);
  const passed = passTurn(before);
  const theyThreatenedMate = passed ? mateInOne(passed) !== null : false;

  const after = new Chess(fenBefore);
  let move;
  try {
    move = after.move(san, { strict: false });
  } catch {
    return null;
  }

  const piece: PieceRef = { type: move.promotion ?? move.piece, square: move.to };
  const homeRank = me === "w" ? "1" : "8";
  const develops =
    (move.piece === "n" || move.piece === "b") &&
    move.from[1] === homeRank &&
    move.to[1] !== homeRank;

  const fork: PieceRef[] = [];
  if (!after.isCheckmate()) {
    for (const target of pieces(after, them)) {
      if (!after.attackers(target.square, me).includes(move.to)) continue;
      const defended = after.attackers(target.square, them).length > 0;
      if (target.type === "k" || VALUE[target.type] > VALUE[piece.type] || !defended) {
        fork.push(target);
      }
    }
  }

  const hangingAfter = hangingPieces(after, me);
  const key = (item: PieceRef) => `${item.type}${item.square}`;
  const wasHanging = new Set(hangingBefore.map(key));
  const hangs = hangingAfter.filter(
    (item) =>
      !wasHanging.has(key(item)) &&
      !(item.square === move.to && wasHanging.has(`${move.piece}${move.from}`)),
  );
  const stillHanging = new Set(
    hangingAfter.map((item) => (item.square === move.to ? `${move.piece}${move.from}` : key(item))),
  );
  const saves = hangingBefore.filter((item) => !stillHanging.has(key(item)));
  const theirWasHanging = new Set(theirHangingBefore.map(key));
  const threatens = hangingPieces(after, them).filter((item) => !theirWasHanging.has(key(item)));

  const allowsMate = after.isCheckmate() ? null : mateInOne(after);
  const passedAfter = passTurn(after);
  const threatensMate =
    !after.isGameOver() && passedAfter !== null && mateInOne(passedAfter) !== null;

  return {
    san: move.san,
    piece,
    mate: after.isCheckmate(),
    check: after.inCheck(),
    castles: move.isKingsideCastle() || move.isQueensideCastle(),
    promotes: !!move.promotion,
    develops,
    captured: move.captured ? { type: move.captured, square: move.to } : null,
    fork:
      fork.length >= 2 ||
      (fork.length === 1 && after.inCheck() && fork[0]!.type !== "k")
        ? fork
        : [],
    hangs,
    saves,
    threatens,
    allowsMate,
    stopsMate: theyThreatenedMate && allowsMate === null,
    threatensMate,
  };
}
