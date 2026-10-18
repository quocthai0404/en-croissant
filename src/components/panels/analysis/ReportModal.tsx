import { Alert, Anchor, Button, Checkbox, Group, Modal, NumberInput, Select, Stack, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { commands, type GoMode } from "@/bindings";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { enginesAtom, referenceDbAtom } from "@/state/atoms";
import { type LocalEngine, requiredEngineSettings } from "@/utils/engines";
import { generateCommentary } from "@/commentary/service";
import { getStableGameId } from "@/commentary/types";
import { getTreeStructureHash } from "@/utils/treeReducer";
import { getMainLine } from "@/utils/chess";
import { unwrap } from "@/utils/unwrap";

const reportSettingsAtom = atomWithStorage("report-settings", {
  novelty: false,
  reversed: true,
  variations: true,
  goMode: { t: "Time", c: 500 } as Exclude<GoMode, { t: "Infinite" }>,
  engine: "",
});

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

  const referenceDb = useAtomValue(referenceDbAtom);
  const engines = useAtomValue(enginesAtom);
  const setEngines = useSetAtom(enginesAtom);
  const localEngines = useMemo(
    () => (engines ?? []).filter((e): e is LocalEngine => e.type === "local"),
    [engines],
  );
  const store = useContext(TreeStateContext)!;
  const addAnalysis = useStore(store, (s) => s.addAnalysis);
  const setGeneratedComments = useStore(store, (s) => s.setGeneratedComments);
  const requestToken = useRef(0);
  const invalidateRequest = useCallback(() => {
    requestToken.current++;
  }, []);
  const [addingEngine, setAddingEngine] = useState(false);

  const [reportSettings, setReportSettings] = useAtom(reportSettingsAtom);

  async function chooseLocalEngine() {
    setAddingEngine(true);
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "UCI engine executable", extensions: ["exe"] }],
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
      engine,
      novelty: reportSettings.novelty && Boolean(referenceDb),
    });
  }, [localEngines, referenceDb, reportSettings]);

  async function analyze() {
    setReportSettings(form.values);
    setInProgress(true);
    closeReportingMode();
    const token = ++requestToken.current;
    const initialRoot = store.getState().root;
    const initialTreeHash = getTreeStructureHash(initialRoot);
    const initialGameId = getStableGameId(initialFen, moves);
    const engine = localEngines.find((e) => e.id === form.values.engine);
    const engineSettings = (engine?.settings ?? []).map((s) => ({
      ...s,
      value: s.value?.toString() ?? "",
    }));

    try {
      const analysis = await commands.analyzeGame(
        `report_${tab}`,
        engine?.path ?? "",
        form.values.goMode,
        {
          annotateNovelties: form.values.novelty && Boolean(referenceDb),
          fen: initialFen,
          referenceDb,
          reversed: form.values.reversed,
          moves,
        },
        engineSettings,
      );

      if (token !== requestToken.current) return;
      if (analysis.status === "error") {
        notifications.show({
          color: "red",
          title: t("Common.Error"),
          message: analysis.error,
        });
        return;
      }

      const latestRoot = store.getState().root;
      if (
        latestRoot.fen !== initialRoot.fen ||
        getTreeStructureHash(latestRoot) !== initialTreeHash ||
        getMainLine(latestRoot).join(" ") !== moves.join(" ")
      ) {
        return;
      }

      addAnalysis(analysis.data, {
        showVariations: form.values.variations,
      });
      const reviewedRoot = store.getState().root;
      const comments = generateCommentary(reviewedRoot, initialGameId, analysis.data);
      setGeneratedComments(
        comments.map(({ position, mainlinePly, text }) => ({
          position,
          comment: {
            schemaVersion: 1,
            gameId: initialGameId,
            ply: mainlinePly,
            text,
          },
        })),
      );
    } catch (error) {
      if (token === requestToken.current) {
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
      onClose={closeReportingMode}
      title={t("Board.Analysis.GenerateReport")}
    >
      <form onSubmit={form.onSubmit(() => analyze())}>
        <Stack>
          {localEngines.length === 0 && (
            <Alert title="Cần thêm engine cục bộ" color="blue">
              <Text size="sm" mb="xs">
                Tải Stockfish cho Windows, giải nén rồi chọn tệp thực thi. Ứng dụng sẽ kiểm tra
                khả năng khởi tạo UCI; Stockfish không đi kèm installer.
              </Text>
              <Anchor href="https://stockfishchess.org/download/" target="_blank" rel="noreferrer">
                Trang tải Stockfish chính thức
              </Anchor>
              <Button type="button" mt="sm" size="xs" loading={addingEngine} onClick={chooseLocalEngine}>
                Chọn tệp engine .exe
              </Button>
            </Alert>
          )}
          <Select
            allowDeselect={false}
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
            <Button type="submit">{t("Board.Analysis.Analyze")}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default memo(ReportModal);
