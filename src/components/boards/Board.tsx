import type { DrawBrushes, DrawShape } from "@lichess-org/chessground/draw";
import { ActionIcon, Box, Button, Center, Group, Text, Tooltip, useMantineTheme } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconChevronRight, IconSwitchVertical } from "@tabler/icons-react";
import {
  makeSquare,
  makeUci,
  type NormalMove,
  type Piece,
  parseSquare,
  parseUci,
  type SquareName,
} from "chessops";
import { chessgroundDests, chessgroundMove } from "chessops/compat";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import { match } from "ts-pattern";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { Chessground, type ChessgroundRef } from "@/chessground/Chessground";
import {
  autoPromoteAtom,
  bestMovesFamily,
  currentEvalOpenAtom,
  currentReviewPreviewAtom,
  currentShowCommentsAtom,
  currentTabAtom,
  deckAtomFamily,
  enableBoardScrollAtom,
  eraseDrawablesOnClickAtom,
  forcedEnPassantAtom,
  is3dAtom,
  materialDisplayAtom,
  moveHighlightAtom,
  moveInputAtom,
  practiceCardStartTimeAtom,
  practiceSessionStatsAtom,
  practiceStateAtom,
  showArrowsAtom,
  showConsecutiveArrowsAtom,
  showCoordinatesAtom,
  showDestsAtom,
  showVariationArrowsAtom,
  snapArrowsAtom,
} from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import classes from "@/styles/Chessboard.module.css";
import { ANNOTATION_INFO, isBasicAnnotation } from "@/utils/annotation";
import { getMainLine, getVariationLine } from "@/utils/chess";
import { chessopsError, forceEnPassant, positionFromFen } from "@/utils/chessops";
import { getTabFile, getTabGameNumber } from "@/utils/tabs";
import { getPreviewCurrentStep, getPreviewFen, getPreviewStepOverlay, isReviewPreviewCurrent } from "@/review/preview";
import { isReviewEvidenceCurrent } from "@/review/evidence";
import { useReviewBoardOrientation } from "@/hooks/useReviewBoardOrientation";
import ShowMaterial from "../common/ShowMaterial";
import { TreeStateContext } from "../common/TreeStateContext";
import FideInfo from "../databases/FideInfo";
import { updateCardPerformance } from "../files/opening";
import { arrowColors } from "../panels/analysis/BestMoves";
import AnnotationHint from "./AnnotationHint";
import { BoardBar } from "./BoardBar";
import Clock from "./Clock";
import EvalBar from "./EvalBar";
import MoveInput from "./MoveInput";
import PromotionModal from "./PromotionModal";

const LARGE_BRUSH = 11;
const MEDIUM_BRUSH = 7.5;
const SMALL_BRUSH = 4;
const BAR_HEIGHT = "1.9rem";

interface ChessboardProps {
  editingMode: boolean;
  viewOnly?: boolean;
  disableVariations?: boolean;
  movable?: "both" | "white" | "black" | "turn" | "none";
  boardRef: React.MutableRefObject<HTMLDivElement | null>;
  whiteTime?: number;
  blackTime?: number;
  practicing?: boolean;
  selectedPiece?: Piece | null;
  onMove?: (uci: string) => void;
  cgRef?: React.Ref<ChessgroundRef>;
  enablePremoves?: boolean;
}

function Board({
  editingMode,
  viewOnly,
  disableVariations,
  movable = "turn",
  boardRef,
  whiteTime,
  blackTime,
  practicing,
  selectedPiece,
  onMove,
  cgRef,
  enablePremoves = false,
}: ChessboardProps) {
  const { t } = useTranslation();

  const is3d = useAtomValue(is3dAtom);

  const store = useContext(TreeStateContext)!;

  const root = useStore(store, (s) => s.root);
  const rootFen = useStore(store, (s) => s.root.fen);
  const position = useStore(store, (s) => s.position);
  const reviewEvidence = useStore(store, (s) => s.report.evidence);
  const moves = useStore(
    store,
    useShallow((s) => getVariationLine(s.root, s.position)),
  );
  const headers = useStore(store, (s) => s.headers);
  const currentNode = useStore(store, (s) => s.currentNode());
  const currentTab = useAtomValue(currentTabAtom);
  const reviewOrientation = useReviewBoardOrientation();
  const reviewPreview = useAtomValue(currentReviewPreviewAtom);
  const setReviewPreview = useSetAtom(currentReviewPreviewAtom);
  const mainline = getMainLine(root);
  const evidenceIsCurrent = isReviewEvidenceCurrent(reviewEvidence, root.fen, mainline);
  const boardPreview = reviewOrientation.isReviewWorkspace && reviewPreview && evidenceIsCurrent && isReviewPreviewCurrent(reviewPreview, {
    activeTab: currentTab?.value ?? "",
    gameId: reviewEvidence.gameId,
    rootFen: root.fen,
    mainlineIdentity: mainline.join(" "),
    position,
    availableMoveIds: reviewEvidence.records.map((record) => record.moveId),
  })
    ? reviewPreview
    : null;
  const boardFen = boardPreview ? getPreviewFen(boardPreview) : currentNode.fen;

  useEffect(() => {
    if (reviewPreview && reviewPreview.activeTab !== currentTab?.value) {
      setReviewPreview(null);
    }
  }, [currentTab?.value, reviewPreview, setReviewPreview]);

  const arrows = useAtomValue(
    bestMovesFamily({
      fen: rootFen,
      gameMoves: moves,
    }),
  );

  const goToNext = useStore(store, (s) => s.goToNext);
  const goToPrevious = useStore(store, (s) => s.goToPrevious);
  const storeMakeMove = useStore(store, (s) => s.makeMove);
  const setHeaders = useStore(store, (s) => s.setHeaders);
  const clearShapes = useStore(store, (s) => s.clearShapes);
  const setShapes = useStore(store, (s) => s.setShapes);
  const setFen = useStore(store, (s) => s.setFen);

  const [pos, error] = positionFromFen(boardFen);
  const [whiteFideOpen, setWhiteFideOpen] = useState(false);
  const [blackFideOpen, setBlackFideOpen] = useState(false);

  const moveInput = useAtomValue(moveInputAtom);
  const showDests = useAtomValue(showDestsAtom);
  const moveHighlight = useAtomValue(moveHighlightAtom);
  const showArrows = useAtomValue(showArrowsAtom);
  const showVariationArrows = useAtomValue(showVariationArrowsAtom);
  const showConsecutiveArrows = useAtomValue(showConsecutiveArrowsAtom);
  const eraseDrawablesOnClick = useAtomValue(eraseDrawablesOnClickAtom);
  const autoPromote = useAtomValue(autoPromoteAtom);
  const forcedEP = useAtomValue(forcedEnPassantAtom);
  const showCoordinates = useAtomValue(showCoordinatesAtom);
  const materialDisplay = useAtomValue(materialDisplayAtom);

  let dests: Map<SquareName, SquareName[]> = pos ? chessgroundDests(pos) : new Map();
  if (forcedEP && pos) {
    dests = forceEnPassant(dests, pos);
  }

  const [pendingMove, setPendingMove] = useState<NormalMove | null>(null);

  const turn = pos?.turn || "white";
  const orientation = reviewOrientation.isReviewWorkspace
    ? reviewOrientation.orientation
    : headers.orientation || "white";
  const toggleOrientation = () => {
    if (reviewOrientation.isReviewWorkspace) {
      reviewOrientation.flip();
    } else {
      setHeaders({
        ...headers,
        fen: root.fen,
        orientation: orientation === "black" ? "white" : "black",
      });
    }
  };

  const keyMap = useAtomValue(keyMapAtom);
  useHotkeys(keyMap.SWAP_ORIENTATION.keys, () => toggleOrientation());
  const tabFile = getTabFile(currentTab);
  const [evalOpen, setEvalOpen] = useAtom(currentEvalOpenAtom);

  const [deck, setDeck] = useAtom(
    deckAtomFamily({
      file: tabFile?.path || "",
      game: getTabGameNumber(currentTab),
    }),
  );

  const setPracticeState = useSetAtom(practiceStateAtom);
  const [sessionStats, setSessionStats] = useAtom(practiceSessionStatsAtom);
  const cardStartTime = useAtomValue(practiceCardStartTimeAtom);

  async function makeMove(move: NormalMove) {
    if (!pos || boardPreview) return;
    const san = makeSan(pos, move);
    if (practicing) {
      const c = deck.positions.find((c) => c.fen === currentNode.fen);
      if (!c) {
        return;
      }

      const i = deck.positions.indexOf(c);
      const timeTaken = Date.now() - cardStartTime;

      if (san !== c.answer) {
        if (sessionStats.mode !== "full") {
          updateCardPerformance(setDeck, i, c.card, 1);
        }
        setPracticeState({
          phase: "incorrect",
          currentFen: c.fen,
          answer: c.answer,
          playedMove: san,
          positionIndex: i,
          timeTaken,
        });
        setSessionStats((prev) => ({
          ...prev,
          incorrect: prev.incorrect + 1,
          streak: 0,
        }));
        notifications.show({
          title: t("Common.Incorrect"),
          message: t("Board.Practice.CorrectMoveWas", { move: c.answer }),
          color: "red",
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        goToNext();
      } else {
        storeMakeMove({
          payload: move,
        });
        setPendingMove(null);
        setPracticeState({
          phase: "correct",
          currentFen: c.fen,
          answer: c.answer,
          positionIndex: i,
          timeTaken,
        });
      }
    } else {
      storeMakeMove({
        payload: move,
        clock: pos.turn === "white" ? whiteTime : blackTime,
      });
      setPendingMove(null);

      if (onMove) {
        onMove(makeUci(move));
      }
    }
  }

  let shapes: DrawShape[] = [];
  if (!boardPreview && showArrows && evalOpen && arrows.size > 0 && pos) {
    const entries = Array.from(arrows.entries()).sort((a, b) => a[0] - b[0]);
    for (const [i, moves] of entries) {
      if (i < 4) {
        const bestWinChance = moves[0].winChance;
        for (const [j, { pv, winChance }] of moves.entries()) {
          const posClone = pos.clone();
          let prevSquare = null;
          for (const [ii, uci] of pv.entries()) {
            const m = parseUci(uci)! as NormalMove;

            posClone.play(m);
            const from = makeSquare(m.from)!;
            const to = makeSquare(m.to)!;
            if (prevSquare === null) {
              prevSquare = from;
            }
            const brushSize = match(bestWinChance - winChance)
              .when(
                (d) => d < 2.5,
                () => LARGE_BRUSH,
              )
              .when(
                (d) => d < 5,
                () => MEDIUM_BRUSH,
              )
              .otherwise(() => SMALL_BRUSH);

            if (ii === 0 || (showConsecutiveArrows && j === 0 && ii % 2 === 0)) {
              if (
                ii < 5 && // max 3 arrows
                !shapes.find((s) => s.orig === from && s.dest === to) &&
                prevSquare === from
              ) {
                shapes.push({
                  orig: from,
                  dest: to,
                  brush: j === 0 ? arrowColors[i].strong : arrowColors[i].pale,
                  modifiers: {
                    lineWidth: brushSize,
                  },
                });
                prevSquare = to;
              } else {
                break;
              }
            }
          }
        }
      }
    }
  }

  // Variation arrows: show all children moves when there are alternatives
  if (!boardPreview && showVariationArrows && !practicing && currentNode.children.length > 1) {
    for (const child of currentNode.children) {
      if (child.move) {
        const m = child.move as NormalMove;
        const from = makeSquare(m.from);
        const to = makeSquare(m.to);
        if (from && to && !shapes.find((s) => s.orig === from && s.dest === to)) {
          shapes.push({
            orig: from,
            dest: to,
            brush: "variation",
            modifiers: {
              lineWidth: MEDIUM_BRUSH,
            },
          });
        }
      }
    }
  }

  if (!boardPreview && currentNode.shapes.length > 0) {
    shapes = shapes.concat(currentNode.shapes);
  }
  if (boardPreview) {
    shapes = shapes.concat(boardPreview.factsOverlay, getPreviewStepOverlay(getPreviewCurrentStep(boardPreview)));
  }

  const hasClock =
    !!whiteTime ||
    !!blackTime ||
    !!headers.time_control ||
    !!headers.white_time_control ||
    !!headers.black_time_control;

  const practiceLock = !!practicing && !deck.positions.find((c) => c.fen === currentNode.fen);

  const movableColor: "white" | "black" | "both" | undefined = useMemo(() => {
    return boardPreview || practiceLock
      ? undefined
      : editingMode
        ? "both"
        : match(movable)
            .with("white", () => "white" as const)
            .with("black", () => "black" as const)
            .with("turn", () => turn)
            .with("both", () => "both" as const)
            .with("none", () => undefined)
            .exhaustive();
  }, [boardPreview, practiceLock, editingMode, movable, turn]);

  const theme = useMantineTheme();
  const color = ANNOTATION_INFO[currentNode.annotations[0]]?.color || "gray";
  const lightColor = theme.colors[color][6];
  const darkColor = theme.colors[color][8];

  const [enableBoardScroll] = useAtom(enableBoardScrollAtom);
  const [snapArrows] = useAtom(snapArrowsAtom);
  const showComments = useAtomValue(currentShowCommentsAtom);
  const visualAnnotation = showComments && !boardPreview ? currentNode.annotations[0] : "";

  const setBoardFen = useCallback(
    (fen: string) => {
      if (!fen || !editingMode || boardPreview) {
        return;
      }
      const newFen = `${fen} ${currentNode.fen.split(" ").slice(1).join(" ")}`;

      if (newFen !== currentNode.fen) {
        setFen(newFen);
      }
    },
    [editingMode, boardPreview, currentNode, setFen],
  );

  useHotkeys(keyMap.TOGGLE_EVAL_BAR.keys, () => setEvalOpen((e) => !e));

  const square = match(currentNode)
    .with({ san: "O-O" }, ({ halfMoves }) => parseSquare(halfMoves % 2 === 1 ? "g1" : "g8"))
    .with({ san: "O-O-O" }, ({ halfMoves }) => parseSquare(halfMoves % 2 === 1 ? "c1" : "c8"))
    .otherwise((node) => node.move?.to);

  const realLastMove =
    currentNode.move && square !== undefined
      ? [chessgroundMove(currentNode.move)[0], makeSquare(square)!]
      : undefined;
  const previewStep = boardPreview ? getPreviewCurrentStep(boardPreview) : undefined;
  const previewMoveFrom = previewStep ? parseSquare(previewStep.from) : undefined;
  const previewMoveTo = previewStep ? parseSquare(previewStep.to) : undefined;
  const lastMove = previewStep && previewMoveFrom !== undefined && previewMoveTo !== undefined
    ? [makeSquare(previewMoveFrom)!, makeSquare(previewMoveTo)!]
    : boardPreview
      ? undefined
      : realLastMove;

  const topPlayer = orientation === "white" ? headers.black : headers.white;
  const bottomPlayer = orientation === "white" ? headers.white : headers.black;

  return (
    <>
      <Box w="100%" h="100%">
        <Box
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            gap: "0.5rem",
            flexWrap: "nowrap",
            overflow: "hidden",
            maxWidth:
              //            topbar   bottompadding                tabs                                  bottomb    topbar   evalbar                                gaps    ???
              `calc(100vh - 2.25rem - var(--mantine-spacing-sm) - 2.5rem - var(--mantine-spacing-sm) - ${BAR_HEIGHT} - ${BAR_HEIGHT} + 1.563rem + var(--mantine-spacing-md) - 1rem  - 0.2rem)`,
          }}
        >
          <BoardBar
            name={topPlayer}
            rating={orientation === "white" ? headers.black_elo : headers.white_elo}
            onNameClick={() => {
              if (orientation === "white") {
                setBlackFideOpen(true);
              } else {
                setWhiteFideOpen(true);
              }
            }}
            height={BAR_HEIGHT}
          >
            <ShowMaterial
              fen={boardFen}
              color={orientation === "white" ? "black" : "white"}
              mode={materialDisplay}
            />
            {hasClock && (
              <Clock
                color={orientation === "black" ? "white" : "black"}
                turn={turn}
                whiteTime={whiteTime}
                blackTime={blackTime}
              />
            )}
          </BoardBar>
          <Group
            style={{
              position: "relative",
              flexWrap: "nowrap",
            }}
            gap="sm"
          >
              {showComments &&
              !boardPreview &&
              currentNode.annotations.length > 0 &&
              currentNode.move &&
              square !== undefined && (
                <Box pl="2.5rem" w="100%" h="100%" pos="absolute">
                  <Box pos="relative" w="100%" h="100%">
                    <AnnotationHint
                      orientation={orientation}
                      square={square}
                      annotation={currentNode.annotations[0]}
                    />
                  </Box>
                </Box>
              )}
            <Box
              h="100%"
              style={{
                width: 25,
              }}
            >
              {!evalOpen && (
                <Center h="100%" w="100%">
                  <ActionIcon
                    size="1rem"
                    onClick={() => setEvalOpen(true)}
                    onContextMenu={(e) => {
                      setEvalOpen(true);
                      e.preventDefault();
                    }}
                  >
                    <IconChevronRight />
                  </ActionIcon>
                </Center>
              )}
              {evalOpen && !boardPreview && <EvalBar score={currentNode.score || null} orientation={orientation} />}
            </Box>
            <Box
              style={
                isBasicAnnotation(visualAnnotation)
                  ? {
                      "--light-color": lightColor,
                      "--dark-color": darkColor,
                    }
                  : undefined
              }
              className={`${classes.chessboard} ${is3d ? "is3d" : ""}`}
              ref={boardRef}
              onClick={() => {
                if (!boardPreview && eraseDrawablesOnClick) clearShapes();
              }}
              onWheel={(e) => {
                if (enableBoardScroll) {
                  if (e.deltaY > 0) {
                    goToNext();
                  } else {
                    goToPrevious();
                  }
                }
              }}
            >
              {reviewOrientation.isReviewWorkspace && (
                <Group
                  pos="absolute"
                  top={6}
                  right={6}
                  gap={4}
                  style={{ zIndex: 10, pointerEvents: "auto" }}
                >
                  {boardPreview && (
                    <Text size="xs" fw={700} c="white" bg="dark.7" px={6} py={3}>
                      ENGINE LINE PREVIEW
                    </Text>
                  )}
                  <Tooltip label="Flip board">
                    <Button
                      size="compact-xs"
                      variant="filled"
                      leftSection={<IconSwitchVertical size="0.9rem" />}
                      onClick={(event) => {
                        event.stopPropagation();
                        reviewOrientation.flip();
                      }}
                      aria-label="Flip board"
                    >
                      Flip board
                    </Button>
                  </Tooltip>
                  {reviewOrientation.preference !== "auto" && (
                    <Tooltip label="Return to Auto orientation">
                      <Button
                        size="compact-xs"
                        variant="default"
                        onClick={(event) => {
                          event.stopPropagation();
                          reviewOrientation.resetToAuto();
                        }}
                        aria-label="Reset board orientation to Auto"
                      >
                        Auto
                      </Button>
                    </Tooltip>
                  )}
                </Group>
              )}
              {!boardPreview && (
                <PromotionModal
                  pendingMove={pendingMove}
                  cancelMove={() => setPendingMove(null)}
                  confirmMove={(p) => {
                    if (pendingMove) {
                      makeMove({
                        from: pendingMove.from,
                        to: pendingMove.to,
                        promotion: p,
                      });
                    }
                  }}
                  turn={turn}
                  orientation={orientation}
                />
              )}

              <Chessground
                ref={cgRef}
                setBoardFen={setBoardFen}
                orientation={orientation}
                fen={boardFen}
                animation={{ enabled: !editingMode }}
                coordinates={showCoordinates !== "no"}
                coordinatesOnSquares={showCoordinates === "all"}
                selectable={{ enabled: !boardPreview }}
                movable={{
                  free: editingMode && !boardPreview,
                  color: movableColor,
                  dests:
                    editingMode || viewOnly
                      ? undefined
                      : disableVariations && currentNode.children.length > 0
                        ? undefined
                        : dests,
                  showDests,
                  events: {
                    after(orig, dest, metadata) {
                      if (!editingMode && !boardPreview) {
                        const from = parseSquare(orig)!;
                        const to = parseSquare(dest)!;

                        if (pos) {
                          if (
                            pos.board.get(from)?.role === "pawn" &&
                            ((dest[1] === "8" && turn === "white") ||
                              (dest[1] === "1" && turn === "black"))
                          ) {
                            if (autoPromote && !metadata.ctrlKey) {
                              makeMove({
                                from,
                                to,
                                promotion: "queen",
                              });
                            } else {
                              setPendingMove({
                                from,
                                to,
                              });
                            }
                          } else {
                            makeMove({
                              from,
                              to,
                            });
                          }
                        }
                      }
                    },
                  },
                }}
                events={{
                  select: (key) => {
                    if (editingMode && !boardPreview && selectedPiece) {
                      const square = parseSquare(key);
                      if (square) {
                        const setup = parseFen(currentNode.fen).unwrap();
                        setup.board.set(square, selectedPiece);
                        setFen(makeFen(setup));
                      }
                    }
                  },
                }}
                turnColor={turn}
                check={moveHighlight && pos?.isCheck()}
                lastMove={moveHighlight && !editingMode ? lastMove : undefined}
                draggable={{
                  enabled: !boardPreview,
                  deleteOnDropOff: editingMode,
                }}
                premovable={{ enabled: enablePremoves && !editingMode && !viewOnly && !boardPreview }}
                drawable={{
                  enabled: !boardPreview,
                  visible: true,
                  defaultSnapToValidMove: snapArrows,
                  autoShapes: shapes,
                  brushes: {
                    variation: {
                      key: "v",
                      color: "#9b59b6",
                      opacity: 0.8,
                      lineWidth: 10,
                    },
                    explain: {
                      key: "e",
                      color: "#28a8a0",
                      opacity: 0.9,
                      lineWidth: 10,
                    },
                    explainSquare: {
                      key: "x",
                      color: "#f2b84b",
                      opacity: 0.42,
                      lineWidth: 10,
                    },
                    preview: {
                      key: "p",
                      color: "#f08735",
                      opacity: 0.95,
                      lineWidth: 12,
                    },
                  } as unknown as DrawBrushes,
                  onChange: (shapes) => {
                    if (!boardPreview) {
                      setShapes(shapes.filter((shape) =>
                        shape.brush === undefined || !["explain", "explainSquare", "preview"].includes(shape.brush),
                      ));
                    }
                  },
                }}
              />
            </Box>
          </Group>
          <BoardBar
            name={bottomPlayer}
            rating={orientation === "white" ? headers.white_elo : headers.black_elo}
            onNameClick={() => {
              if (orientation === "white") {
                setWhiteFideOpen(true);
              } else {
                setBlackFideOpen(true);
              }
            }}
            height={BAR_HEIGHT}
          >
            {error && (
              <Text ta="center" c="red">
                {t(chessopsError(error))}
              </Text>
            )}

            {moveInput && !boardPreview && <MoveInput currentNode={currentNode} />}

            <ShowMaterial fen={boardFen} color={orientation} mode={materialDisplay} />
            {hasClock && (
              <Clock color={orientation} turn={turn} whiteTime={whiteTime} blackTime={blackTime} />
            )}
          </BoardBar>
        </Box>
      </Box>
      <FideInfo opened={whiteFideOpen} setOpened={setWhiteFideOpen} name={headers.white} />
      <FideInfo opened={blackFideOpen} setOpened={setBlackFideOpen} name={headers.black} />
    </>
  );
}

export default memo(Board);
