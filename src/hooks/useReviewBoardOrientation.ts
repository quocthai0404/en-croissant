import { useCallback, useContext } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useStore } from "zustand";
import { resolveViewerSide } from "@/commentary/perspective";
import {
  activeTabAtom,
  currentTabAtom,
  currentTabSelectedAtom,
  reviewBoardOrientationByTabAtom,
  sessionsAtom,
} from "@/state/atoms";
import { getMainLine } from "@/utils/chess";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  getReviewBoardContextId,
  resolveReviewBoardOrientation,
  type ReviewBoardOrientationPreference,
} from "@/review/orientation";

export function useReviewBoardOrientation() {
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (state) => state.root);
  const headers = useStore(store, (state) => state.headers);
  const activeTab = useAtomValue(activeTabAtom) ?? "";
  const tab = useAtomValue(currentTabAtom);
  const selectedTabView = useAtomValue(currentTabSelectedAtom);
  const sessions = useAtomValue(sessionsAtom);
  const preferences = useAtomValue(reviewBoardOrientationByTabAtom);
  const setPreferences = useSetAtom(reviewBoardOrientationByTabAtom);

  const contextId = getReviewBoardContextId(activeTab, root.fen, headers, getMainLine(root));
  const stored = preferences[activeTab];
  const preference = stored?.contextId === contextId ? stored.preference : "auto";
  const detectedPlayer = resolveViewerSide("auto", headers, sessions);
  const orientation = resolveReviewBoardOrientation(
    preference,
    detectedPlayer,
    headers.orientation ?? "white",
  );
  const isReviewWorkspace = tab?.type === "analysis" && selectedTabView === "analysis";

  const setPreference = useCallback(
    (next: ReviewBoardOrientationPreference) => {
      if (!activeTab) return;
      setPreferences((current) => ({
        ...current,
        [activeTab]: { contextId, preference: next },
      }));
    },
    [activeTab, contextId, setPreferences],
  );

  const flip = useCallback(() => {
    setPreference(orientation === "white" ? "black" : "white");
  }, [orientation, setPreference]);

  const resetToAuto = useCallback(() => setPreference("auto"), [setPreference]);

  return { orientation, preference, isReviewWorkspace, flip, resetToAuto };
}
