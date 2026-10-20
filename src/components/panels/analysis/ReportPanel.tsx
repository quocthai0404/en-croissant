import {
  Accordion,
  Alert,
  Badge,
  Button,
  Grid,
  Group,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconInfoCircle, IconZoomCheck } from "@tabler/icons-react";
import cx from "clsx";
import equal from "fast-deep-equal";
import { useAtom, useAtomValue } from "jotai";
import React, { memo, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { getNodeAtPath } from "@/utils/treeReducer";
import { commands } from "@/bindings";
import EvalChart from "@/components/common/EvalChart";
import ProgressButton from "@/components/common/ProgressButton";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  activeTabAtom,
  currentReportModalOpenAtom,
  currentReviewPreviewAtom,
  sessionsAtom,
} from "@/state/atoms";
import { ANNOTATION_INFO, isBasicAnnotation } from "@/utils/annotation";
import { getGameStats, getMainLine } from "@/utils/chess";
import { type CommentaryPerspective, resolveViewerSide } from "@/commentary/perspective";
import { buildExplainPresentation, buildVerifiedExplainOverlay } from "@/review/explain";
import { isReviewEvidenceCurrent } from "@/review/evidence";
import { classificationGlyph, classificationLabel } from "@/review/classification";
import { buildMoveCoachSummary, findReviewRecordAtPosition, getReviewRowScrollTop } from "@/review/coach";
import {
  buildLegalPreviewLine,
  choosePreferredPreviewLine,
  getPreviewCurrentStep,
  isReviewPreviewCurrent,
  updateReviewPreviewLine,
  updateReviewPreviewPlayback,
  type ReviewPreviewLineType,
} from "@/review/preview";
import type { ReviewEvidenceRecord } from "@/review/types";
import classes from "./AnalysisPanel.module.css";
import ReportModal from "./ReportModal";

const EMPTY_REVIEW_RECORDS: ReviewEvidenceRecord[] = [];

function ReportPanel() {
  const { t } = useTranslation();

  const activeTab = useAtomValue(activeTabAtom);
  const sessions = useAtomValue(sessionsAtom);

  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const headers = useStore(store, (s) => s.headers);
  const commentaryPerspective = useStore(store, (s) => s.commentaryPerspective ?? "auto");
  const position = useStore(store, (s) => s.position);
  const setCommentaryPerspective = useStore(store, (s) => s.setCommentaryPerspective);
  const evidence = useStore(store, (s) => s.report.evidence);
  const goToMove = useStore(store, (s) => s.goToMove);
  const currentNode = getNodeAtPath(root, position);
  const [reviewPreview, setReviewPreview] = useAtom(currentReviewPreviewAtom);
  const [reportingMode, setReportingMode] = useAtom(currentReportModalOpenAtom);

  const inProgress = useStore(store, (s) => s.report.inProgress);
  const setInProgress = useStore(store, (s) => s.setReportInProgress);
  const requestInvalidator = useRef<(() => void) | null>(null);
  const setRequestInvalidator = useCallback((invalidate: (() => void) | null) => {
    requestInvalidator.current = invalidate;
  }, []);

  const stats = useMemo(() => getGameStats(root), [root]);
  const mainline = useMemo(() => getMainLine(root), [root]);
  const evidenceIsCurrent = isReviewEvidenceCurrent(evidence, root.fen, mainline);
  const records = evidenceIsCurrent ? evidence.records : EMPTY_REVIEW_RECORDS;
  const selectedRecord = findReviewRecordAtPosition(records, position);
  const viewerSide = resolveViewerSide(commentaryPerspective, headers, sessions);
  const activePreviewRecord = reviewPreview
    ? records.find((record) => record.moveId === reviewPreview.moveId)
    : undefined;
  const previewPresentation = activePreviewRecord
    ? buildExplainPresentation(activePreviewRecord, records, viewerSide)
    : null;
  const previewLine = reviewPreview?.lineType ? reviewPreview.lines[reviewPreview.lineType] : undefined;
  const currentPvStep = reviewPreview ? getPreviewCurrentStep(reviewPreview) : undefined;
  const reviewRowElements = useRef(new Map<string, HTMLDivElement>());
  const reviewListViewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedRecord) return;
    const viewport = reviewListViewport.current;
    const row = reviewRowElements.current.get(selectedRecord.moveId);
    if (!viewport || !row) return;

    const viewportRect = viewport.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    viewport.scrollTop = getReviewRowScrollTop(
      viewport.scrollTop,
      { top: viewportRect.top, bottom: viewportRect.bottom },
      { top: rowRect.top, bottom: rowRect.bottom },
    );
  }, [selectedRecord]);

  useEffect(() => {
    if (!reviewPreview) return;
    if (!isReviewPreviewCurrent(reviewPreview, {
      activeTab: activeTab ?? "",
      gameId: evidence?.gameId ?? "",
      rootFen: root.fen,
      mainlineIdentity: mainline.join(" "),
      position,
      availableMoveIds: records.map((record) => record.moveId),
    })) setReviewPreview(null);
  }, [activeTab, mainline, position, records, reviewPreview, root.fen, setReviewPreview]);

  useEffect(() => {
    if (!reviewPreview?.playing) return;
    const timer = window.setInterval(() => {
      setReviewPreview((current) => {
        if (!current?.playing || !current.lineType) return current;
        const line = current.lines[current.lineType];
        if (!line || current.stepIndex >= line.steps.length) {
          return { ...current, playing: false };
        }
        const stepIndex = current.stepIndex + 1;
        return { ...current, stepIndex, playing: stepIndex < line.steps.length };
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [reviewPreview?.playing, setReviewPreview]);

  const handleCancel = useCallback(() => {
    requestInvalidator.current?.();
    commands.cancelAnalysis(`report_${activeTab}`);
  }, [activeTab]);

  const openReportingMode = useCallback(() => {
    setReportingMode(true);
  }, [setReportingMode]);

  const closeReportingMode = useCallback(() => {
    setReportingMode(false);
  }, [setReportingMode]);

  const changeCommentaryPerspective = useCallback((value: string | null) => {
      if (value !== "auto" && value !== "white" && value !== "black" && value !== "neutral") {
        return;
      }
      const perspective: CommentaryPerspective = value;
      setCommentaryPerspective(perspective);
    }, [setCommentaryPerspective]);

  const openExplain = useCallback((record: ReviewEvidenceRecord) => {
    const beforeNode = getNodeAtPath(root, record.position.slice(0, -1));
    const afterNode = getNodeAtPath(root, record.position);
    const alternative = buildLegalPreviewLine(beforeNode.fen, record.bestAlternativeBefore);
    const continuation = buildLegalPreviewLine(afterNode.fen, record.bestReplyAfter);
    const lines = {
      ...(alternative ? { alternative } : {}),
      ...(continuation ? { continuation } : {}),
    };
    const lineType: ReviewPreviewLineType | null = choosePreferredPreviewLine(
      record.classification,
      alternative,
      continuation,
    );
    const explanation = buildExplainPresentation(record, records, viewerSide);
    const baseFen = lineType
      ? lines[lineType]?.startFen ?? afterNode.fen
      : explanation.boardPosition === "before"
        ? beforeNode.fen
        : afterNode.fen;

    setReviewPreview({
      activeTab: activeTab ?? "",
      gameId: evidence?.gameId ?? "",
      rootFen: root.fen,
      mainlineIdentity: mainline.join(" "),
      sourcePosition: [...position],
      moveId: record.moveId,
      lineType,
      baseFen,
      lines,
      stepIndex: 0,
      playing: false,
      factsOverlay: buildVerifiedExplainOverlay(record),
    });
  }, [activeTab, evidence?.gameId, mainline, position, records, root, setReviewPreview, viewerSide]);

  const closeExplain = useCallback(() => setReviewPreview(null), [setReviewPreview]);

  const setPreviewLine = useCallback((lineType: ReviewPreviewLineType) => {
    setReviewPreview((current) => current ? updateReviewPreviewLine(current, lineType) : current);
  }, [setReviewPreview]);

  const updatePreviewStep = useCallback((action: "previous" | "next" | "replay" | "toggle") => {
    setReviewPreview((current) => current ? updateReviewPreviewPlayback(current, action) : current);
  }, [setReviewPreview]);

  return (
    <Stack h="100%" gap="xs" miw={0}>
      <ReportModal
        tab={activeTab!}
        initialFen={root.fen}
        moves={mainline}
        reportingMode={reportingMode}
        closeReportingMode={closeReportingMode}
        setInProgress={setInProgress}
        setRequestInvalidator={setRequestInvalidator}
      />
      <Group px="xs" justify="space-between">
        <ProgressButton
          id={`report_${activeTab}`}
          redoable
          disabled={root.children.length === 0}
          leftIcon={<IconZoomCheck size="0.875rem" />}
          onClick={openReportingMode}
          onCancel={handleCancel}
          initInstalled={false}
          labels={{
            action: t("Board.Analysis.GenerateReport"),
            completed: t("Board.Analysis.ReportGenerated"),
            inProgress: t("Board.Analysis.GeneratingReport"),
          }}
          inProgress={inProgress}
          setInProgress={setInProgress}
        />
        {evidenceIsCurrent && <Badge color="teal" variant="light">Review ready · {records.length} moves</Badge>}
      </Group>
      <ScrollArea offsetScrollbars flex={1} mih={0}>
      <Stack mb="lg" gap="xs" mr="xs" px="xs">
        <MoveCoachCard record={selectedRecord} hasReview={records.length > 0} />
        {reviewPreview && activePreviewRecord && previewPresentation && (
          <Paper withBorder p="sm" data-engine-line-preview="true" aria-live="polite">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={2}>
                <Text fw={700} size="sm">Engine Line Preview · {activePreviewRecord.san}</Text>
                <Text size="xs" c="dimmed">
                  {reviewPreview.lineType === "alternative"
                    ? "Better alternative · position before the played move"
                    : reviewPreview.lineType === "continuation"
                      ? "Best continuation · position after the played move"
                      : "No playable engine line is available for this move"}
                </Text>
              </Stack>
              <Button size="compact-xs" variant="subtle" onClick={closeExplain}>Exit Preview</Button>
            </Group>
            <Stack gap={4} mt="xs">
              {previewPresentation.paragraphs.map((paragraph, index) => (
                <Text key={index} size="sm">{paragraph}</Text>
              ))}
              <Text size="xs" c="dimmed">
                Engine PV · depth {previewLine?.depth ?? "–"} · variation, not a claim that the line is forced.
              </Text>
            </Stack>
            {Boolean(reviewPreview.lines.alternative?.steps.length && reviewPreview.lines.continuation?.steps.length) ? (
              <Group gap="xs" mt="sm">
                <Button
                  size="compact-xs"
                  variant={reviewPreview.lineType === "alternative" ? "filled" : "default"}
                  onClick={() => setPreviewLine("alternative")}
                >
                  Better alternative
                </Button>
                <Button
                  size="compact-xs"
                  variant={reviewPreview.lineType === "continuation" ? "filled" : "default"}
                  onClick={() => setPreviewLine("continuation")}
                >
                  Best continuation
                </Button>
              </Group>
            ) : null}
            {previewLine?.steps.length ? (
              <Stack gap="xs" mt="sm">
                <Group justify="space-between" wrap="wrap">
                  <Text size="sm" fw={600}>
                    {currentPvStep
                      ? `Current PV move: ${currentPvStep.san}`
                      : `Starting position · next ${previewLine.steps[0]?.san ?? "–"}`}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Step {reviewPreview.stepIndex}/{previewLine.steps.length} · 0.9 s per move
                  </Text>
                </Group>
                <Group gap={4} wrap="wrap" aria-label="Principal variation moves">
                  {previewLine.steps.map((step, index) => (
                    <Badge
                      key={`${index}-${step.uci}`}
                      variant={index === reviewPreview.stepIndex - 1 ? "filled" : "light"}
                      color={index === reviewPreview.stepIndex - 1 ? "orange" : "gray"}
                    >
                      {step.san}
                    </Badge>
                  ))}
                </Group>
                <Group gap="xs" wrap="wrap">
                  <Button size="compact-xs" onClick={() => updatePreviewStep("toggle")}>
                    {reviewPreview.playing ? "Pause" : "Play"}
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="default"
                    disabled={reviewPreview.stepIndex === 0}
                    onClick={() => updatePreviewStep("previous")}
                  >
                    Previous step
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="default"
                    disabled={reviewPreview.stepIndex >= previewLine.steps.length}
                    onClick={() => updatePreviewStep("next")}
                  >
                    Next step
                  </Button>
                  <Button size="compact-xs" variant="default" onClick={() => updatePreviewStep("replay")}>
                    Replay
                  </Button>
                </Group>
              </Stack>
            ) : (
              <Alert color="yellow" mt="sm" title="No legal PV to play">
                The saved engine line is empty or contains no legal opening move from this position. The game has not been changed, and Stockfish was not rerun.
              </Alert>
            )}
          </Paper>
        )}
        <Group justify="space-between" mt="xs">
          <Text fw={700}>Move Review</Text>
          <Select
            w={150}
            aria-label="Explain perspective"
            data={[
              { value: "auto", label: "Auto" },
              { value: "white", label: "White" },
              { value: "black", label: "Black" },
              { value: "neutral", label: "Neutral" },
            ]}
            value={commentaryPerspective}
            onChange={changeCommentaryPerspective}
          />
        </Group>
        <Text size="xs" c="dimmed">Select a move to update Coach; Explain opens the deeper analysis.</Text>
        {records.length > 0 ? (
          <Paper withBorder style={{ overflow: "hidden" }}>
            <ScrollArea
              h={Math.min(400, Math.max(180, records.length * 43))}
              viewportRef={reviewListViewport}
            >
              <Stack gap={0}>
                {records.map((record) => (
                  <ReviewMoveRow
                    key={record.moveId}
                    record={record}
                    selected={selectedRecord?.moveId === record.moveId}
                    elementRef={(element) => {
                      if (element) reviewRowElements.current.set(record.moveId, element);
                      else reviewRowElements.current.delete(record.moveId);
                    }}
                    onSelect={() => {
                      setReviewPreview(null);
                      goToMove(record.position);
                    }}
                    onExplain={() => openExplain(record)}
                  />
                ))}
              </Stack>
            </ScrollArea>
          </Paper>
        ) : (
          <Alert icon={<IconInfoCircle size="1rem" />} color="gray" title="No current review evidence">
            Generate Game Review to classify moves and enable local Explain. Existing NAGs and comments remain unchanged.
          </Alert>
        )}
        {stats.whiteAccuracy > 0 && stats.blackAccuracy > 0 && (
          <Group grow>
            <AccuracyCard
              color={t("Common.WHITE")}
              accuracy={stats.whiteAccuracy}
              cpl={stats.whiteCPL}
            />
            <AccuracyCard
              color={t("Common.BLACK")}
              accuracy={stats.blackAccuracy}
              cpl={stats.blackCPL}
            />
          </Group>
        )}

        <Paper withBorder p="md">
          <EvalChart isAnalysing={inProgress} startAnalysis={openReportingMode} />
        </Paper>
        {evidenceIsCurrent && evidence?.performance && (
          <Paper withBorder p="sm">
            <Group justify="space-between" wrap="wrap">
              <Text fw={600} size="sm">{evidence.performance.profile.toUpperCase()} review</Text>
              <Text size="xs" c="dimmed">
                Budget {evidence.performance.plannedBudgetMs ? `${Math.round(evidence.performance.plannedBudgetMs / 1000)}s` : "Custom"}
                {` · elapsed ${Math.round(evidence.performance.elapsedMs / 1000)}s · Threads ${evidence.performance.threads ?? "?"} · Hash ${evidence.performance.hashMb ?? "?"} MB`}
              </Text>
            </Group>
            <Text size="xs" c="dimmed" mt={4}>
              Depth {evidence.performance.minDepth ?? "–"}/{evidence.performance.medianDepth ?? "–"}/{evidence.performance.maxDepth ?? "–"} min/median/max · benchmark {evidence.performance.benchmarkStatus}
            </Text>
          </Paper>
        )}
        {currentNode.generatedComment && (
          <Accordion variant="contained">
            <Accordion.Item value="legacy">
              <Accordion.Control>Legacy generated comment (preserved)</Accordion.Control>
              <Accordion.Panel><Text style={{ whiteSpace: "pre-wrap" }}>{currentNode.generatedComment.text}</Text></Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )}
        <GameStats {...stats} />
      </Stack>
      </ScrollArea>
    </Stack>
  );
}

function ReviewMoveRow({
  record,
  selected,
  elementRef,
  onSelect,
  onExplain,
}: {
  record: ReviewEvidenceRecord;
  selected: boolean;
  elementRef: (element: HTMLDivElement | null) => void;
  onSelect: () => void;
  onExplain: () => void;
}) {
  const summary = buildMoveCoachSummary(record);
  const color = {
    book: "blue",
    brilliant: "cyan",
    best: "teal",
    excellent: "green",
    good: "lime",
    inaccuracy: "yellow",
    mistake: "orange",
    blunder: "red",
    unclassified: "gray",
  }[record.classification];
  return (
    <Group
      ref={elementRef}
      gap={0}
      wrap="nowrap"
      px="xs"
      py={5}
      data-review-move-id={record.moveId}
      style={{ borderBottom: "1px solid var(--mantine-color-dark-4)", background: selected ? "var(--mantine-color-dark-5)" : undefined }}
    >
      <UnstyledButton onClick={onSelect} style={{ flex: 1, minWidth: 0 }} aria-label={`Select ${summary.moveNumber}${record.san}, ${summary.classification}, evaluation ${summary.evaluation}`}>
        <Group gap="xs" wrap="nowrap">
        <Tooltip label={`${classificationLabel(record.classification)} · depth ${record.beforeDepth ?? "–"}/${record.afterDepth ?? "–"}`}>
          <Badge w={28} variant="light" color={color} px={2}>{classificationGlyph(record.classification)}</Badge>
        </Tooltip>
        <Text size="xs" c="dimmed" w={42}>{summary.moveNumber}</Text>
        <Text size="lg" c={record.mover === "white" ? "gray.2" : "dark.1"} w={22}>{summary.pieceGlyph}</Text>
        <Text fw={700} flex={1}>{summary.move}</Text>
        <Badge size="xs" variant="light" color={color}>{summary.classification}</Badge>
        <Text size="sm" w={54} ta="right" ff="monospace">{summary.evaluation}</Text>
        </Group>
      </UnstyledButton>
      <Button size="compact-xs" variant="subtle" onClick={onExplain}>Explain</Button>
    </Group>
  );
}

function MoveCoachCard({
  record,
  hasReview,
}: {
  record: ReviewEvidenceRecord | undefined;
  hasReview: boolean;
}) {
  if (!record) {
    return (
      <Paper withBorder p="sm" role="status" aria-live="polite">
        <Text size="xs" fw={700} c="dimmed">MOVE COACH</Text>
        <Text c="dimmed" mt={4}>
          {hasReview ? "Select a move below to see its short review." : "Generate Game Review to see a short review for every move."}
        </Text>
      </Paper>
    );
  }

  const summary = buildMoveCoachSummary(record);
  const color = {
    book: "blue",
    brilliant: "cyan",
    best: "teal",
    excellent: "green",
    good: "lime",
    inaccuracy: "yellow",
    mistake: "orange",
    blunder: "red",
    unclassified: "gray",
  }[record.classification];

  return (
    <Paper withBorder p="sm" role="status" aria-live="polite" aria-label="Selected move Coach">
      <Text size="xs" fw={700} c="dimmed">MOVE COACH · {summary.moveNumber}</Text>
      <Group justify="space-between" wrap="nowrap" mt={4}>
        <Group gap="xs" wrap="nowrap" miw={0}>
          <Text size="xl" c={record.mover === "white" ? "gray.2" : "dark.1"}>{summary.pieceGlyph}</Text>
          <Stack gap={0} miw={0}>
            <Group gap="xs" wrap="wrap">
              <Text fw={700} size="lg">{summary.move}</Text>
              <Badge size="xs" variant="light" color={color}>{summary.classification}</Badge>
            </Group>
            <Text size="sm">{summary.phrase}</Text>
          </Stack>
        </Group>
        <Text fw={700} size="lg" ff="monospace">{summary.evaluation}</Text>
      </Group>
    </Paper>
  );
}

type Stats = ReturnType<typeof getGameStats>;

const GameStats = memo(
  function GameStats({ whiteAnnotations, blackAnnotations }: Stats) {
    const { t } = useTranslation();

    const store = useContext(TreeStateContext)!;
    const goToAnnotation = useStore(store, (s) => s.goToAnnotation);

    return (
      <Paper withBorder>
        <Grid columns={12} align="center" p="md">
          {Object.keys(ANNOTATION_INFO)
            .filter((a) => isBasicAnnotation(a))
            .map((annotation) => {
              const s = annotation as "??" | "?" | "?!" | "!!" | "!" | "!?";
              const { name, color, translationKey } = ANNOTATION_INFO[s];
              const w = whiteAnnotations[s];
              const b = blackAnnotations[s];
              return (
                <React.Fragment key={annotation}>
                  <Grid.Col
                    className={cx(w > 0 && classes.label)}
                    span={3}
                    style={{ textAlign: "center" }}
                    c={w > 0 ? color : undefined}
                    onClick={() => {
                      if (w > 0) {
                        goToAnnotation(s, "white");
                      }
                    }}
                  >
                    {w}
                  </Grid.Col>
                  <Grid.Col
                    span={2}
                    style={{ textAlign: "center", fontWeight: "bold" }}
                    c={w + b > 0 ? color : undefined}
                  >
                    {annotation}
                  </Grid.Col>
                  <Grid.Col span={4} c={w + b > 0 ? color : undefined}>
                    {translationKey ? t(`Annotate.${translationKey}`) : name}
                  </Grid.Col>
                  <Grid.Col
                    className={cx(b > 0 && classes.label)}
                    span={3}
                    style={{ textAlign: "center" }}
                    c={b > 0 ? color : undefined}
                    onClick={() => {
                      if (b > 0) {
                        goToAnnotation(s, "black");
                      }
                    }}
                  >
                    {b}
                  </Grid.Col>
                </React.Fragment>
              );
            })}
        </Grid>
      </Paper>
    );
  },
  (prev, next) => {
    return (
      equal(prev.whiteAnnotations, next.whiteAnnotations) &&
      equal(prev.blackAnnotations, next.blackAnnotations)
    );
  },
);

function AccuracyCard({ color, cpl, accuracy }: { color: string; cpl: number; accuracy: number }) {
  const { t } = useTranslation();

  return (
    <Paper withBorder p="xs">
      <Group justify="space-between">
        <Stack gap={0} align="start">
          <Text c="dimmed">{color}</Text>
          <Text fz="sm">{cpl.toFixed(1)} ACPL</Text>
        </Stack>
        <Stack gap={0} align="center">
          <Text fz="xl" lh="normal">
            {accuracy.toFixed(1)}%
          </Text>
          <Text fz="sm" c="dimmed" lh="normal">
            {t("Board.Analysis.Accuracy")}
          </Text>
        </Stack>
      </Group>
    </Paper>
  );
}
export default ReportPanel;
