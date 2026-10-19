import type { Score } from "@/bindings";
import type { CommentaryEvent, ChessFact, Side } from "@/commentary/types";
import type { ReviewClassification } from "./classification";

export interface ReviewPv {
  san: string[];
  uci: string[];
  depth: number;
  score: Score;
}

export interface ReviewEvidenceRecord {
  moveId: string;
  mainlinePly: number;
  position: number[];
  san: string;
  playedMove: { from: string; to: string };
  piece: "p" | "n" | "b" | "r" | "q" | "k";
  mover: Side;
  beforeScore: Score | null;
  afterScore: Score | null;
  beforeDepth: number | null;
  afterDepth: number | null;
  classification: ReviewClassification;
  loss: number | null;
  facts: ChessFact[];
  event?: CommentaryEvent;
  opening?: { eco: string; name: string };
  bestAlternativeBefore?: ReviewPv;
  bestReplyAfter?: ReviewPv;
}

export interface ReviewEvidenceSnapshot {
  schemaVersion: 1;
  gameId: string;
  rootFen: string;
  mainlineIdentity: string;
  createdAt: number;
  records: ReviewEvidenceRecord[];
  performance?: {
    profile: "auto" | "fast" | "balanced" | "deep" | "custom";
    plannedBudgetMs: number | null;
    elapsedMs: number;
    minDepth: number | null;
    medianDepth: number | null;
    maxDepth: number | null;
    threads: number | null;
    hashMb: number | null;
    benchmarkStatus: "matched" | "fallback" | "manual" | "not-applicable";
  };
}
