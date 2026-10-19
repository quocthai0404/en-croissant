import {
  Accordion,
  Alert,
  Badge,
  Button,
  Divider,
  Grid,
  Group,
  Modal,
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
import React, { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { getNodeAtPath } from "@/utils/treeReducer";
import { commands } from "@/bindings";
import EvalChart from "@/components/common/EvalChart";
import ProgressButton from "@/components/common/ProgressButton";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  activeTabAtom,
  currentExplainOverlayAtom,
  currentReportModalOpenAtom,
  sessionsAtom,
} from "@/state/atoms";
import { ANNOTATION_INFO, isBasicAnnotation } from "@/utils/annotation";
import { getGameStats, getMainLine } from "@/utils/chess";
import { type CommentaryPerspective, resolveViewerSide } from "@/commentary/perspective";
import { buildExplainPresentation } from "@/review/explain";
import { isReviewEvidenceCurrent } from "@/review/evidence";
import { classificationGlyph, classificationLabel } from "@/review/classification";
import type { ReviewEvidenceRecord } from "@/review/types";
import { formatScore } from "@/utils/score";
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
  const [, setExplainOverlay] = useAtom(currentExplainOverlayAtom);
  const [explainRecord, setExplainRecord] = useState<ReviewEvidenceRecord | null>(null);
  const [explainBoardPath, setExplainBoardPath] = useState<number[] | null>(null);
  const [restorePath, setRestorePath] = useState<number[] | null>(null);
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
  const viewerSide = resolveViewerSide(commentaryPerspective, headers, sessions);

  useEffect(() => {
    if (!explainRecord || (explainBoardPath && position.join(".") !== explainBoardPath.join("."))) {
      setExplainOverlay([]);
    }
  }, [position, explainRecord, explainBoardPath, setExplainOverlay]);

  useEffect(() => () => setExplainOverlay([]), [setExplainOverlay]);

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
    setExplainOverlay([]);
    setRestorePath(record.position);
    goToMove(record.position);
    const presentation = buildExplainPresentation(record, records, viewerSide);
    const boardPath = presentation.boardPosition === "before" ? record.position.slice(0, -1) : record.position;
    setExplainBoardPath(boardPath);
    if (presentation.boardPosition === "before") goToMove(boardPath);
    setExplainOverlay(presentation.overlay);
    setExplainRecord(record);
  }, [goToMove, records, setExplainOverlay, viewerSide]);

  const closeExplain = useCallback(() => {
    const path = restorePath;
    const boardWasStillOnExplainPosition = Boolean(
      explainBoardPath && position.join(".") === explainBoardPath.join("."),
    );
    setExplainRecord(null);
    setExplainBoardPath(null);
    setExplainOverlay([]);
    setRestorePath(null);
    if (path && boardWasStillOnExplainPosition) goToMove(path);
  }, [explainBoardPath, goToMove, position, restorePath, setExplainOverlay]);

  const explainPresentation = explainRecord
    ? buildExplainPresentation(explainRecord, records, viewerSide)
    : null;

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
        {records.length > 0 ? (
          <Paper withBorder style={{ overflow: "hidden" }}>
            <ScrollArea h={Math.min(330, Math.max(150, records.length * 43))}>
              <Stack gap={0}>
                {records.map((record) => (
                  <ReviewMoveRow
                    key={record.moveId}
                    record={record}
                    selected={position.join(".") === record.position.join(".")}
                    onSelect={() => {
                      setExplainRecord(null);
                      setExplainOverlay([]);
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
      <Modal opened={Boolean(explainRecord)} onClose={closeExplain} title={explainRecord ? `Explain · ${Math.ceil(explainRecord.mainlinePly / 2)}${explainRecord.mainlinePly % 2 ? "." : "..."}${explainRecord.san}` : "Explain"} centered>
        {explainRecord && explainPresentation && (
          <Stack>
            {explainPresentation.paragraphs.map((paragraph, index) => <Text key={index}>{paragraph}</Text>)}
            <Divider />
            <Text size="xs" c="dimmed">
              Evidence: {explainRecord.beforeDepth ?? "–"}/{explainRecord.afterDepth ?? "–"} depth · {explainRecord.facts.filter((fact) => fact.confidence === "verified").length} verified fact(s)
            </Text>
            <Button onClick={closeExplain}>Close</Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

function ReviewMoveRow({
  record,
  selected,
  onSelect,
  onExplain,
}: {
  record: ReviewEvidenceRecord;
  selected: boolean;
  onSelect: () => void;
  onExplain: () => void;
}) {
  const pieceGlyphs: Record<ReviewEvidenceRecord["piece"], { white: string; black: string }> = {
    p: { white: "♙", black: "♟" },
    n: { white: "♘", black: "♞" },
    b: { white: "♗", black: "♝" },
    r: { white: "♖", black: "♜" },
    q: { white: "♕", black: "♛" },
    k: { white: "♔", black: "♚" },
  };
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
  const evaluation = record.afterScore ? formatScore(record.afterScore.value) : "–";
  const moveNumber = Math.ceil(record.mainlinePly / 2);
  const moveLabel = record.mainlinePly % 2 ? `${moveNumber}.` : `${moveNumber}...`;

  return (
    <Group gap={0} wrap="nowrap" px="xs" py={5} style={{ borderBottom: "1px solid var(--mantine-color-dark-4)", background: selected ? "var(--mantine-color-dark-5)" : undefined }}>
      <UnstyledButton onClick={onSelect} style={{ flex: 1, minWidth: 0 }} aria-label={`Select ${moveLabel}${record.san}, ${classificationLabel(record.classification)}, evaluation ${evaluation}`}>
        <Group gap="xs" wrap="nowrap">
        <Tooltip label={`${classificationLabel(record.classification)} · depth ${record.beforeDepth ?? "–"}/${record.afterDepth ?? "–"}`}>
          <Badge w={28} variant="light" color={color} px={2}>{classificationGlyph(record.classification)}</Badge>
        </Tooltip>
        <Text size="xs" c="dimmed" w={38}>{moveLabel}</Text>
        <Text size="lg" c={record.mover === "white" ? "gray.2" : "dark.1"} w={22}>{pieceGlyphs[record.piece][record.mover]}</Text>
        <Text fw={700} flex={1}>{record.san}</Text>
        <Badge variant="light" color={color} visibleFrom="sm">{classificationLabel(record.classification)}</Badge>
        <Text size="sm" w={54} ta="right" ff="monospace">{evaluation}</Text>
        </Group>
      </UnstyledButton>
      <Button size="compact-xs" variant="subtle" onClick={onExplain}>Explain</Button>
    </Group>
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
