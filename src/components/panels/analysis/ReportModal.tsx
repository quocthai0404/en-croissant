import { Alert, Button, Checkbox, Group, Modal, NumberInput, Select, Stack, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { commands, type EngineConfig, type GoMode } from "@/bindings";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { enginesAtom, referenceDbAtom } from "@/state/atoms";
import { type LocalEngine, requiredEngineSettings } from "@/utils/engines";
import { usePlatform } from "@/utils/files";
import { getReviewFactsForGame } from "@/commentary/service";
import { getStableGameId } from "@/commentary/types";
import { getTreeStructureHash } from "@/utils/treeReducer";
import { getMainLine } from "@/utils/chess";
import { unwrap } from "@/utils/unwrap";
import { buildReviewEvidence, type OpeningMembership } from "@/review/evidence";
import {
  allocateAdaptiveTimes,
  applyProfileEngineOverrides,
  chooseBenchmarkThreads,
  derivePositionWeights,
  getAutoHashMb,
  getBenchmarkFingerprint,
  getThreadCandidates,
  profileBudgetMs,
  type BenchmarkSnapshot,
  type ReviewProfile,
} from "@/review/performance";

const reportSettingsAtom = atomWithStorage("report-settings", {
  novelty: false,
  reversed: true,
  variations: true,
  goMode: { t: "Time", c: 500 } as Exclude<GoMode, { t: "Infinite" }>,
  engine: "",
  profile: "auto" as ReviewProfile,
  benchmarks: {} as Record<string, BenchmarkSnapshot>,
  manualOverrides: { threads: null as number | null, hashMb: null as number | null },
});

const timestampNow = () => Date.now();

function spinOptionRange(
  config: EngineConfig,
  name: string,
): { min: number; max: number } | null {
  const option = config.options.find((candidate) => candidate.value.name.toLowerCase() === name.toLowerCase());
  if (!option || option.type !== "spin") return null;
  return {
    min: Number(option.value.min ?? 1),
    max: Number(option.value.max ?? Number.MAX_SAFE_INTEGER),
  };
}

function applyEngineProfile(
  engine: LocalEngine,
  profile: ReviewProfile,
  threads: number,
  hashMb: number,
): { name: string; value: string }[] {
  const values = (engine.settings ?? []).map((setting) => ({
    name: setting.name,
    value: setting.value?.toString() ?? "",
  }));
  return applyProfileEngineOverrides(values, profile, threads, hashMb);
}

function ReportModal({
  tab,
  initialFen,
  moves,
  reportingMode,
  closeReportingMode,
  setInProgress,
  setRequestInvalidator,
}: {
  tab: string;
  initialFen: string;
  moves: string[];
  reportingMode: boolean;
  closeReportingMode: () => void;
  setInProgress: (value: boolean) => void;
  setRequestInvalidator: (invalidate: (() => void) | null) => void;
}) {
  const { t } = useTranslation();
  const { os } = usePlatform();

  const referenceDb = useAtomValue(referenceDbAtom);
  const engines = useAtomValue(enginesAtom);
  const setEngines = useSetAtom(enginesAtom);
  const localEngines = useMemo(
    () => (engines ?? []).filter((e): e is LocalEngine => e.type === "local"),
    [engines],
  );
  const store = useContext(TreeStateContext)!;
  const addAnalysis = useStore(store, (s) => s.addAnalysis);
  const setReviewEvidence = useStore(store, (s) => s.setReviewEvidence);
  const requestToken = useRef(0);
  const invalidateRequest = useCallback(() => {
    requestToken.current++;
  }, []);
  const [addingEngine, setAddingEngine] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);

  const [reportSettings, setReportSettings] = useAtom(reportSettingsAtom);

  async function chooseLocalEngine() {
    setAddingEngine(true);
    try {
      const selected = await open({
        multiple: false,
        filters: os === "windows" ? [{ name: "UCI engine executable", extensions: ["exe"] }] : [],
      });
      if (typeof selected !== "string") return;

      const config = unwrap(await commands.getEngineConfig(selected));
      const newEngine: LocalEngine = {
        type: "local",
        id: crypto.randomUUID(),
        version: "",
        name: config.name,
        path: selected,
        image: "",
        elo: undefined,
        loaded: true,
        settings: config.options
          .filter((option) => requiredEngineSettings.includes(option.value.name))
          .map((option) => ({
            name: option.value.name,
            value: "default" in option.value ? (option.value.default?.toString() ?? "") : "",
          })),
      };
      setEngines(async (previous) => {
        const current = await previous;
        if (current?.some((engine) => engine.type === "local" && engine.path === selected)) {
          return current;
        }
        return [...(current ?? []), newEngine];
      });
    } catch {
      notifications.show({
        color: "red",
        title: "Không thể dùng engine này",
        message: "Chess Reviewer không nhận được cấu hình UCI hợp lệ từ tệp đã chọn.",
      });
    } finally {
      setAddingEngine(false);
    }
  }

  const form = useForm({
    initialValues: reportSettings,
    validate: {
      engine: (value) => {
        if (!value) return t("Board.Analysis.EngineRequired");
      },
    },
  });

  async function preparePerformance(engine: LocalEngine, forceBenchmark = false) {
    let capabilities: Awaited<ReturnType<typeof commands.getSystemCapabilities>> | null = null;
    try {
      capabilities = await commands.getSystemCapabilities();
    } catch {
      // Safe fallback is used when OS capability detection is unavailable.
    }
    const config = unwrap(await commands.getEngineConfig(engine.path));
    const engineIdentity = `${config.name || engine.name}|${engine.version || ""}`;
    const fingerprint = capabilities
      ? getBenchmarkFingerprint(engine.path, engineIdentity, capabilities)
      : `${engine.path.toLowerCase()}|${engineIdentity.toLowerCase()}|fallback`;
    let benchmark: BenchmarkSnapshot | undefined = (form.values.benchmarks ?? {})[fingerprint];
    let benchmarkStatus: "matched" | "fallback" | "manual" | "not-applicable" = "not-applicable";

    if (form.values.profile === "auto") {
      if (!forceBenchmark && benchmark) {
        benchmarkStatus = "matched";
      } else if (capabilities) {
        setBenchmarking(true);
        try {
          const threadRange = spinOptionRange(config, "Threads");
          const candidates = getThreadCandidates(
            capabilities.logicalCores,
            threadRange?.max ?? 1,
            threadRange?.min ?? 1,
          );
          const hashMb = getAutoHashMb(capabilities);
          const result = unwrap(await commands.benchmarkEngine(`report_${tab}`, engine.path, candidates, hashMb));
          const threads = chooseBenchmarkThreads(result);
          if (threads === null) throw new Error("Engine benchmark returned no usable throughput samples.");
          const hashRange = spinOptionRange(config, "Hash");
          const selectedHash = hashRange ? Math.min(hashRange.max, Math.max(hashRange.min, hashMb)) : 64;
          benchmark = { fingerprint, threads, hashMb: selectedHash, result, createdAt: timestampNow() };
          const nextBenchmarks = { ...(form.values.benchmarks ?? {}), [fingerprint]: benchmark };
          form.setFieldValue("benchmarks", nextBenchmarks);
          setReportSettings((previous) => ({ ...previous, ...form.values, benchmarks: nextBenchmarks }));
          benchmarkStatus = "matched";
        } catch (error) {
          benchmarkStatus = "fallback";
          benchmark = undefined;
          const nextBenchmarks = { ...(form.values.benchmarks ?? {}) };
          delete nextBenchmarks[fingerprint];
          form.setFieldValue("benchmarks", nextBenchmarks);
          setReportSettings((previous) => ({ ...previous, ...form.values, benchmarks: nextBenchmarks }));
          if (!forceBenchmark) {
            notifications.show({
              color: "yellow",
              title: "Auto benchmark unavailable",
              message: error instanceof Error ? error.message : "Using 1 thread and 64 MB Hash.",
            });
          }
        } finally {
          setBenchmarking(false);
        }
      } else {
        benchmarkStatus = "fallback";
        if (forceBenchmark) {
          benchmark = undefined;
          const nextBenchmarks = { ...(form.values.benchmarks ?? {}) };
          delete nextBenchmarks[fingerprint];
          form.setFieldValue("benchmarks", nextBenchmarks);
          setReportSettings((previous) => ({ ...previous, ...form.values, benchmarks: nextBenchmarks }));
        }
      }
    }

    const autoHash = capabilities ? getAutoHashMb(capabilities) : 64;
    const threadRange = spinOptionRange(config, "Threads");
    const threadCandidates = getThreadCandidates(
      capabilities?.logicalCores ?? 1,
      threadRange?.max ?? 1,
      threadRange?.min ?? 1,
    );
    const configuredThreads = Number(engine.settings?.find((setting) => setting.name.toLowerCase() === "threads")?.value) || 1;
    const configuredHash = Number(engine.settings?.find((setting) => setting.name.toLowerCase() === "hash")?.value) || 64;
    const requestedThreads = form.values.profile === "custom"
      ? form.values.manualOverrides?.threads ?? configuredThreads
      : form.values.profile === "auto"
      ? benchmark?.threads ?? 1
      : form.values.profile === "fast"
        ? 1
        : form.values.profile === "deep"
        ? threadCandidates.at(-1) ?? 1
          : threadCandidates[Math.min(1, threadCandidates.length - 1)] ?? 1;
    const threads = threadRange
      ? Math.min(threadRange.max, Math.max(threadRange.min, requestedThreads))
      : 1;
    const hashRange = spinOptionRange(config, "Hash");
    const requestedHash = form.values.profile === "custom"
      ? form.values.manualOverrides?.hashMb ?? configuredHash
      : form.values.profile === "fast" ? Math.min(128, autoHash)
      : form.values.profile === "balanced" ? Math.min(512, autoHash)
        : form.values.profile === "deep" ? autoHash
          : benchmark?.hashMb ?? 64;
    const hashMb = hashRange ? Math.min(hashRange.max, Math.max(hashRange.min, requestedHash)) : 64;
    return { capabilities, config, threads, hashMb, benchmarkStatus };
  }

  async function rebenchmarkSelectedEngine() {
    const engine = localEngines.find((candidate) => candidate.id === form.values.engine);
    if (!engine) return;
    setBenchmarking(true);
    try {
      const result = await preparePerformance(engine, true);
      if (result.benchmarkStatus === "matched") {
        notifications.show({ color: "teal", title: "Benchmark complete", message: "Auto settings were saved for this engine and hardware profile." });
      } else {
        notifications.show({ color: "yellow", title: "Benchmark unavailable", message: "Auto will use the safe fallback: one thread and 64 MB Hash." });
      }
    } catch (error) {
      notifications.show({ color: "red", title: "Benchmark failed", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBenchmarking(false);
    }
  }

  useEffect(() => {
    invalidateRequest();
    return () => {
      invalidateRequest();
      void commands.cancelAnalysis(`report_${tab}`);
      setInProgress(false);
    };
  }, [invalidateRequest, setInProgress, tab]);

  useEffect(() => {
    setRequestInvalidator(invalidateRequest);
    return () => {
      setRequestInvalidator(null);
    };
  }, [invalidateRequest, setRequestInvalidator]);

  useEffect(() => {
    const engine =
      localEngines.length === 0
        ? ""
        : !reportSettings.engine || !localEngines.some((l) => l.id === reportSettings.engine)
          ? localEngines[0].id
          : reportSettings.engine;

    form.setValues({
      ...reportSettings,
      profile: reportSettings.profile ?? "auto",
      benchmarks: reportSettings.benchmarks ?? {},
      manualOverrides: reportSettings.manualOverrides ?? { threads: null, hashMb: null },
      engine,
      novelty: reportSettings.novelty && Boolean(referenceDb),
    });
  }, [localEngines, referenceDb, reportSettings]);

  async function analyze() {
    setReportSettings(form.values);
    setInProgress(true);
    closeReportingMode();
    const token = ++requestToken.current;
    const startedAt = timestampNow();
    const initialRoot = store.getState().root;
    const initialTreeHash = getTreeStructureHash(initialRoot);
    const initialGameId = getStableGameId(initialFen, moves);
    const engine = localEngines.find((e) => e.id === form.values.engine);
    if (!engine) {
      setInProgress(false);
      notifications.show({ color: "red", title: t("Common.Error"), message: "Select a local engine before starting Game Review." });
      return;
    }

    try {
      const profile = form.values.profile ?? "auto";
      const performance = await preparePerformance(engine);
      if (token !== requestToken.current) return;
      const engineSettings = applyEngineProfile(engine, profile, performance.threads, performance.hashMb);
      const baseOptions = {
        annotateNovelties: form.values.novelty && Boolean(referenceDb),
        fen: initialFen,
        referenceDb,
        reversed: form.values.reversed,
        moves,
        positionTimeMs: null,
        progressOffset: 0,
        progressScale: 1,
        finishProgress: true,
      };
      const isCurrentRequest = () => {
        const latestRoot = store.getState().root;
        return token === requestToken.current &&
          latestRoot.fen === initialRoot.fen &&
          getTreeStructureHash(latestRoot) === initialTreeHash &&
          getMainLine(latestRoot).join(" ") === moves.join(" ");
      };

      let finalAnalysis: Awaited<ReturnType<typeof commands.analyzeGame>>;
      let plannedBudget: number | null = null;
      if (profile === "custom") {
        finalAnalysis = await commands.analyzeGame(
          `report_${tab}`,
          engine.path,
          form.values.goMode,
          baseOptions,
          engineSettings,
        );
      } else {
        plannedBudget = profileBudgetMs(profile, moves.length);
        const positionCount = moves.length + 1;
        const scanTimeMs = Math.min(100, Math.max(30, Math.floor((plannedBudget ?? 90_000) * 0.12 / positionCount)));
        const scan = await commands.analyzeGame(
          `report_${tab}`,
          engine.path,
          { t: "Time", c: scanTimeMs },
          { ...baseOptions, positionTimeMs: null, progressOffset: 0, progressScale: 0.15, finishProgress: false },
          engineSettings,
        );
        if (scan.status === "error") throw new Error(scan.error);
        if (!isCurrentRequest()) return;

        const scanContexts = getReviewFactsForGame(initialRoot, initialGameId, scan.data);
        const scores = scan.data.map((item) => {
          const value = item.best[0]?.score.value;
          if (!value) return null;
          return value.type === "mate" ? Math.sign(value.value) * 10_000 : value.value;
        });
        const playedMoveIsBest = new Array(scan.data.length).fill(true) as boolean[];
        const hasVerifiedTactic = new Array(scan.data.length).fill(false) as boolean[];
        const hasMateTransition = scan.data.map((item, index) => {
          const value = item.best[0]?.score.value;
          const next = scan.data[index + 1]?.best[0]?.score.value;
          return value?.type === "mate" || next?.type === "mate";
        });
        scanContexts.forEach(({ context, facts }, index) => {
          playedMoveIsBest[index] = context.san === context.bestAlternativeBefore?.sanMoves[0];
          hasVerifiedTactic[index] = facts.some((fact) => fact.confidence === "verified" &&
            ["MATE", "CAPTURED_PIECE", "OPENED_ATTACK_LINE", "LEGAL_CAPTURE_AVAILABLE", "ENGINE_RECOMMENDED_CAPTURE"].includes(fact.code));
        });
        const weights = derivePositionWeights(scores, playedMoveIsBest, hasVerifiedTactic, hasMateTransition);
        const scanElapsed = timestampNow() - startedAt;
        const finalBudget = Math.max(positionCount, (plannedBudget ?? 90_000) - scanElapsed);
        const positionTimeMs = allocateAdaptiveTimes(finalBudget, weights);
        finalAnalysis = await commands.analyzeGame(
          `report_${tab}`,
          engine.path,
          { t: "Time", c: Math.max(1, Math.min(...positionTimeMs)) },
          { ...baseOptions, positionTimeMs, progressOffset: 0.15, progressScale: 0.85, finishProgress: true },
          engineSettings,
        );
      }

      if (token !== requestToken.current) return;
      if (finalAnalysis.status === "error") {
        notifications.show({ color: "red", title: t("Common.Error"), message: finalAnalysis.error });
        return;
      }
      if (!isCurrentRequest()) return;

      addAnalysis(finalAnalysis.data, {
        showVariations: form.values.variations,
      });
      const reviewedRoot = store.getState().root;
      if (
        reviewedRoot.fen !== initialRoot.fen ||
        getMainLine(reviewedRoot).join(" ") !== moves.join(" ")
      ) {
        return;
      }
      const contexts = getReviewFactsForGame(reviewedRoot, initialGameId, finalAnalysis.data);
      let openingMemberships: Array<OpeningMembership | null> = contexts.map(() => null);
      if (contexts.length > 0) {
        try {
          openingMemberships = unwrap(await commands.getOpeningMembership(contexts.map(({ context }) => context.fenAfter)));
        } catch {
          // Opening data is optional; missing matches only suppress Book.
        }
      }
      if (token !== requestToken.current || getMainLine(store.getState().root).join(" ") !== moves.join(" ")) return;
      const evidence = buildReviewEvidence(reviewedRoot, initialGameId, finalAnalysis.data, openingMemberships);
      const depths = finalAnalysis.data.map((item) => item.best[0]?.depth).filter((depth): depth is number => depth !== undefined && depth > 0).sort((a, b) => a - b);
      const summaryEngineSettings = applyEngineProfile(engine, profile, performance.threads, performance.hashMb);
      const quantile = (fraction: number) => depths.length ? depths[Math.floor((depths.length - 1) * fraction)]! : null;
      evidence.performance = {
        profile,
        plannedBudgetMs: plannedBudget,
        elapsedMs: timestampNow() - startedAt,
        minDepth: depths[0] ?? null,
        medianDepth: quantile(0.5),
        maxDepth: depths.at(-1) ?? null,
        threads: Number(summaryEngineSettings.find((option) => option.name.toLowerCase() === "threads")?.value) || null,
        hashMb: Number(summaryEngineSettings.find((option) => option.name.toLowerCase() === "hash")?.value) || null,
        benchmarkStatus: profile === "custom" ? "manual" : performance.benchmarkStatus,
      };
      setReviewEvidence(evidence);
    } catch (error) {
      if (token === requestToken.current && !String(error).toLowerCase().includes("cancel")) {
        notifications.show({
          color: "red",
          title: t("Common.Error"),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (token === requestToken.current) setInProgress(false);
    }
  }

  return (
    <Modal
      opened={reportingMode}
      onClose={() => {
        if (benchmarking) void commands.cancelAnalysis(`report_${tab}`);
        closeReportingMode();
      }}
      title={t("Board.Analysis.GenerateReport")}
    >
      <form onSubmit={form.onSubmit(() => analyze())}>
        <Stack>
          {localEngines.length === 0 && (
            <Alert title="Không tìm thấy Stockfish đi kèm" color="red">
              <Text size="sm" mb="xs">
                Bản cài đặt bình thường tự thêm Stockfish. Hãy cài lại ứng dụng nếu engine đi kèm
                bị thiếu, hoặc chọn một UCI engine khác bên dưới.
              </Text>
              <Button type="button" mt="sm" size="xs" loading={addingEngine} onClick={chooseLocalEngine}>
                Chọn tệp Stockfish/UCI
              </Button>
            </Alert>
          )}
          <Select
            allowDeselect={false}
            disabled={benchmarking}
            withAsterisk
            label={t("Common.Engine")}
            placeholder="Pick one"
            data={
              localEngines.map((engine) => {
                return {
                  value: engine.id,
                  label: engine.name,
                };
              }) ?? []
            }
            {...form.getInputProps("engine")}
          />
          <Select
            allowDeselect={false}
            disabled={benchmarking}
            label="Review performance"
            description="Auto benchmarks this local engine once per engine/hardware profile."
            data={[
              { value: "auto", label: "Auto" },
              { value: "fast", label: "Fast · about 30 seconds / 80 plies" },
              { value: "balanced", label: "Balanced · about 90 seconds / 80 plies" },
              { value: "deep", label: "Deep · about 5 minutes / 80 plies" },
              { value: "custom", label: "Custom" },
            ]}
            value={form.values.profile}
            onChange={(value) => {
              if (value === "auto" || value === "fast" || value === "balanced" || value === "deep" || value === "custom") {
                form.setFieldValue("profile", value);
              }
            }}
          />
          {form.values.profile === "auto" && (
            <Group>
              <Button type="button" variant="light" loading={benchmarking} disabled={benchmarking} onClick={rebenchmarkSelectedEngine}>
                Re-benchmark selected engine
              </Button>
              {benchmarking && (
                <Button type="button" color="red" variant="subtle" onClick={() => void commands.cancelAnalysis(`report_${tab}`)}>
                  Cancel benchmark
                </Button>
              )}
            </Group>
          )}
          {form.values.profile === "custom" && <Stack>
          <Group wrap="nowrap">
            <Select
              allowDeselect={false}
              comboboxProps={{
                position: "bottom",
                middlewares: { flip: false, shift: false },
              }}
              data={[
                { label: t("GoMode.Depth"), value: "Depth" },
                { label: t("Board.Analysis.Time"), value: "Time" },
                { label: t("GoMode.Nodes"), value: "Nodes" },
              ]}
              value={form.values.goMode.t}
              onChange={(v) => {
                const newGo = form.values.goMode;
                newGo.t = v as "Depth" | "Time" | "Nodes";
                form.setFieldValue("goMode", newGo);
              }}
            />
            <NumberInput
              min={1}
              value={form.values.goMode.c as number}
              onChange={(v) =>
                form.setFieldValue("goMode", {
                  ...(form.values.goMode as any),
                  c: (v || 1) as number,
                })
              }
            />
          </Group>
          <Group grow>
            <NumberInput
              min={1}
              label="Threads override"
              value={form.values.manualOverrides?.threads ?? (Number(localEngines.find((engine) => engine.id === form.values.engine)?.settings?.find((setting) => setting.name.toLowerCase() === "threads")?.value) || 1)}
              onChange={(value) => form.setFieldValue("manualOverrides.threads", Number(value) || null)}
            />
            <NumberInput
              min={1}
              label="Hash override (MB)"
              value={form.values.manualOverrides?.hashMb ?? (Number(localEngines.find((engine) => engine.id === form.values.engine)?.settings?.find((setting) => setting.name.toLowerCase() === "hash")?.value) || 64)}
              onChange={(value) => form.setFieldValue("manualOverrides.hashMb", Number(value) || null)}
            />
          </Group>
          </Stack>}

          <Checkbox
            label={t("Board.Analysis.Reversed")}
            description={t("Board.Analysis.Reversed.Desc")}
            {...form.getInputProps("reversed", { type: "checkbox" })}
          />

          <Checkbox
            label={t("Board.Analysis.AnnotateNovelties")}
            description={t("Board.Analysis.AnnotateNovelties.Desc")}
            disabled={!referenceDb}
            {...form.getInputProps("novelty", { type: "checkbox" })}
          />

          <Checkbox
            label={t("Board.Analysis.ShowVariations")}
            description={t("Board.Analysis.ShowVariations.Desc")}
            {...form.getInputProps("variations", { type: "checkbox" })}
          />

          <Group justify="right">
            <Button type="submit" disabled={benchmarking}>{t("Board.Analysis.Analyze")}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default memo(ReportModal);
