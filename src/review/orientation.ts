import type { GameHeaders } from "@/utils/treeReducer";
import type { ViewerSide } from "@/commentary/types";

export type ReviewBoardOrientationPreference = "auto" | "white" | "black";

export function resolveReviewBoardOrientation(
  preference: ReviewBoardOrientationPreference,
  detectedPlayer: ViewerSide,
  fallback: "white" | "black" = "white",
): "white" | "black" {
  if (preference !== "auto") return preference;
  return detectedPlayer === "white" || detectedPlayer === "black" ? detectedPlayer : fallback;
}

export function getReviewBoardContextId(
  tabId: string,
  rootFen: string,
  headers: Pick<GameHeaders, "white" | "black" | "date" | "event">,
  mainline: string[],
): string {
  return [tabId, rootFen, headers.white, headers.black, headers.date ?? "", headers.event ?? "", mainline.join(" ")].join("\u001f");
}
