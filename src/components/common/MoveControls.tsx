import { ActionIcon, Group } from "@mantine/core";
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
} from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { memo, useContext } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useStore } from "zustand";
import { useDeleteMove } from "@/hooks/useDeleteMove";
import { keyMapAtom } from "@/state/keybinds";
import { currentReviewPreviewAtom } from "@/state/atoms";
import { TreeStateContext } from "./TreeStateContext";

function MoveControls({ readOnly }: { readOnly?: boolean }) {
  const store = useContext(TreeStateContext)!;
  const next = useStore(store, (s) => s.goToNext);
  const previous = useStore(store, (s) => s.goToPrevious);
  const start = useStore(store, (s) => s.goToStart);
  const end = useStore(store, (s) => s.goToEnd);
  const deleteMove = useDeleteMove();
  const startBranch = useStore(store, (s) => s.goToBranchStart);
  const endBranch = useStore(store, (s) => s.goToBranchEnd);
  const nextBranch = useStore(store, (s) => s.nextBranch);
  const previousBranch = useStore(store, (s) => s.previousBranch);
  const nextBranching = useStore(store, (s) => s.nextBranching);
  const previousBranching = useStore(store, (s) => s.previousBranching);
  const [, setReviewPreview] = useAtom(currentReviewPreviewAtom);

  const nextMove = () => {
    setReviewPreview(null);
    next();
  };
  const previousMove = () => {
    setReviewPreview(null);
    previous();
  };
  const goToStart = () => {
    setReviewPreview(null);
    start();
  };
  const goToEnd = () => {
    setReviewPreview(null);
    end();
  };

  const keyMap = useAtomValue(keyMapAtom);
  useHotkeys(keyMap.PREVIOUS_MOVE.keys, previousMove);
  useHotkeys(keyMap.NEXT_MOVE.keys, nextMove);
  useHotkeys(keyMap.GO_TO_START.keys, goToStart);
  useHotkeys(keyMap.GO_TO_END.keys, goToEnd);
  useHotkeys(keyMap.DELETE_MOVE.keys, readOnly ? () => {} : () => deleteMove());
  useHotkeys(keyMap.GO_TO_BRANCH_START.keys, startBranch);
  useHotkeys(keyMap.GO_TO_BRANCH_END.keys, endBranch);
  useHotkeys(keyMap.NEXT_BRANCH.keys, nextBranch);
  useHotkeys(keyMap.PREVIOUS_BRANCH.keys, previousBranch);
  useHotkeys(keyMap.NEXT_BRANCHING.keys, nextBranching);
  useHotkeys(keyMap.PREVIOUS_BRANCHING.keys, previousBranching);

  return (
    <Group grow gap="xs">
      <ActionIcon variant="default" size="lg" onClick={goToStart}>
        <IconChevronsLeft />
      </ActionIcon>
      <ActionIcon variant="default" size="lg" onClick={previousMove}>
        <IconChevronLeft />
      </ActionIcon>
      <ActionIcon variant="default" size="lg" onClick={nextMove}>
        <IconChevronRight />
      </ActionIcon>
      <ActionIcon variant="default" size="lg" onClick={goToEnd}>
        <IconChevronsRight />
      </ActionIcon>
    </Group>
  );
}

export default memo(MoveControls);
