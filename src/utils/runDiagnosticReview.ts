import { downloadDir, dirname, join, resolve } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { commands, type GoMode } from "@/bindings";
import { resolveViewerSide } from "@/commentary/perspective";
import type { CommentaryPerspective } from "@/commentary/perspective";
import { createTreeStore } from "@/state/store/tree";
import { enginesAtom, referenceDbAtom, sessionsAtom } from "@/state/atoms";
import { getStableGameId } from "@/commentary/types";
import { getGameFromUrl } from "@/utils/import";
import { getLastMainlinePosition, getMainLine, getOpening, parsePGN } from "@/utils/chess";
import { type LocalEngine } from "@/utils/engines";
import { buildDiagnosticReportData, formatDiagnosticMarkdown, type DiagnosticReport } from "@/utils/diagnosticReport";

type ReportGoMode = Extract<GoMode, { t: "Depth" | "Time" | "Nodes" }>;

type StoredReportSettings = {
  engine?: string;
  goMode?: GoMode;
  novelty?: boolean;
  reversed?: boolean;
  variations?: boolean;
};

const DEFAULT_GO_MODE: ReportGoMode = { t: "Time", c: 500 };

function readReportSettings(): Required<Pick<StoredReportSettings, "novelty" | "reversed" | "variations">> & {
  engine: string;
  goMode: ReportGoMode;
} {
  let stored: StoredReportSettings = {};
  try {
    const raw = localStorage.getItem("report-settings");
    if (raw) stored = JSON.parse(raw) as StoredReportSettings;
  } catch {
    // Corrupt local settings should not prevent a diagnostic run; use ReportModal defaults.
  }

  const candidate = stored.goMode;
  const goMode =
    candidate &&
    (candidate.t === "Time" || candidate.t === "Depth" || candidate.t === "Nodes") &&
    Number.isFinite(candidate.c) &&
    candidate.c > 0
      ? candidate
      : DEFAULT_GO_MODE;

  return {
    engine: typeof stored.engine === "string" ? stored.engine : "",
    goMode,
    novelty: stored.novelty === true,
    reversed: typeof stored.reversed === "boolean" ? stored.reversed : true,
    variations: typeof stored.variations === "boolean" ? stored.variations : true,
  };
}

function outputBaseName(value: string): string {
  return /\.(?:json|md)$/i.test(value) ? value.replace(/\.(?:json|md)$/i, "") : value;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runDiagnosticReview(url: string, output?: string) {
  const createdAt = new Date().toISOString();
  let stage = "validate-url";
  let report: DiagnosticReport;

  try {
    const parsedUrl = new URL(url);
    if (!/(^|\.)chess\.com$/i.test(parsedUrl.hostname)) {
      throw new Error("Only direct Chess.com game links are supported.");
    }

    stage = "fetch-chess-com-game";
    const pgn = await getGameFromUrl(url);
    if (!pgn.trim()) throw new Error("Chess.com returned no PGN for this game link.");

    stage = "parse-pgn";
    const tree = await parsePGN(pgn);
    const uciMoves = getMainLine(tree.root);
    if (uciMoves.length === 0) throw new Error("The imported PGN contains no legal mainline moves.");

    const settings = readReportSettings();
    const store = getDefaultStore();
    const localEngines = (store.get(enginesAtom) ?? []).filter(
      (engine): engine is LocalEngine => engine.type === "local",
    );
    const engine = localEngines.find((candidate) => candidate.id === settings.engine) ?? localEngines[0];
    if (!engine) throw new Error("No local UCI engine is configured. Restore the bundled Stockfish or add a local engine first.");

    const referenceDb = store.get(referenceDbAtom);
    const annotateNovelties = settings.novelty && Boolean(referenceDb);
    if (annotateNovelties && referenceDb) {
      stage = "load-reference-database";
      const preload = await commands.preloadReferenceDb(referenceDb);
      if (preload.status === "error") throw new Error(preload.error);
    }

    const openingPromise = getOpening(tree.root, getLastMainlinePosition(tree.root)).catch(() => "");
    const gameId = getStableGameId(tree.root.fen, uciMoves);
    const engineSettings = (engine.settings ?? []).map((setting) => ({
      name: setting.name,
      value: setting.value?.toString() ?? "",
    }));

    stage = "stockfish-analysis";
    const analysis = await commands.analyzeGame(
      `diagnostic_${gameId}`,
      engine.path,
      settings.goMode,
      {
        annotateNovelties,
        fen: tree.root.fen,
        referenceDb: annotateNovelties ? referenceDb : null,
        reversed: settings.reversed,
        moves: uciMoves,
        positionTimeMs: null,
        progressOffset: 0,
        progressScale: 1,
        finishProgress: true,
      },
      engineSettings,
    );
    if (analysis.status === "error") throw new Error(analysis.error);

    stage = "attach-analysis-and-render-commentary";
    const analyzedTree = createTreeStore(undefined, tree);
    analyzedTree.getState().addAnalysis(analysis.data, { showVariations: settings.variations });
    const reviewedTree = analyzedTree.getState();
    const openingName = await openingPromise;
    const requestedPerspective: CommentaryPerspective = tree.commentaryPerspective ?? "auto";
    const viewerSide = resolveViewerSide(
      requestedPerspective,
      tree.headers,
      store.get(sessionsAtom),
    );

    report = buildDiagnosticReportData({
      url,
      pgn,
      tree: { ...tree, root: reviewedTree.root },
      gameId,
      uciMoves,
      analysis: analysis.data,
      openingName,
      requestedPerspective,
      viewerSide,
      engine: {
        name: engine.name,
        version: engine.version,
        goMode: settings.goMode,
        reversed: settings.reversed,
        variations: settings.variations,
        annotateNovelties,
      },
      createdAt,
    });
  } catch (error) {
    report = {
      schemaVersion: 1,
      status: "error",
      createdAt,
      source: { platform: "Chess.com", url },
      error: { stage, message: describeError(error) },
    };
  }

  let baseName: string;
  if (output?.trim()) {
    baseName = await resolve(outputBaseName(output.trim()));
  } else {
    const stamp = createdAt.replace(/[:.]/g, "-");
    baseName = await join(await downloadDir(), `ChessReview-${stamp}`);
  }

  await mkdir(await dirname(baseName), { recursive: true });
  await writeTextFile(`${baseName}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeTextFile(`${baseName}.md`, formatDiagnosticMarkdown(report));

  return {
    status: report.status,
    jsonPath: `${baseName}.json`,
    markdownPath: `${baseName}.md`,
    report,
  };
}
