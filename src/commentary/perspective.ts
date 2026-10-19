import type { GameHeaders } from "@/utils/treeReducer";
import type { Session } from "@/utils/session";
import type { ViewerSide } from "./types";

export type CommentaryPerspective = "auto" | ViewerSide;

function normalizeIdentity(value: string | undefined): string {
  return value?.trim().replace(/^@/, "").toLowerCase() ?? "";
}

export function resolveViewerSide(
  perspective: CommentaryPerspective,
  headers: GameHeaders,
  sessions: Session[],
): ViewerSide {
  if (perspective !== "auto") return perspective;

  const identities = new Set(
    sessions
      .flatMap((session) => [session.player, session.chessCom?.username, session.lichess?.username])
      .map(normalizeIdentity)
      .filter(Boolean),
  );
  const white = normalizeIdentity(headers.white);
  const black = normalizeIdentity(headers.black);
  const isWhite = Boolean(white && identities.has(white));
  const isBlack = Boolean(black && identities.has(black));

  if (isWhite === isBlack) return "neutral";
  return isWhite ? "white" : "black";
}
