import {
  ActionIcon,
  Autocomplete,
  createTheme,
  Input,
  localStorageColorSchemeManager,
  MantineProvider,
  Textarea,
  TextInput,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { getMatches } from "@tauri-apps/plugin-cli";
import { exit } from "@tauri-apps/plugin-process";
import { listen } from "@tauri-apps/api/event";
import { attachConsole, info, warn } from "@tauri-apps/plugin-log";
import { getDefaultStore, useAtom, useAtomValue, useSetAtom } from "jotai";
import { ContextMenuProvider } from "mantine-contextmenu";
import { useEffect, useRef } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import {
  activeTabAtom,
  databaseConversionStateAtom,
  enginesAtom,
  fontSizeAtom,
  is3dAtom,
  pieceSetAtom,
  primaryColorAtom,
  referenceDbAtom,
  spellCheckAtom,
  storedDatabasesDirAtom,
  storedDocumentDirAtom,
  storedEnginesDirAtom,
  storedPuzzlesDirAtom,
  tabsAtom,
  telemetryEnabledAtom,
} from "./state/atoms";

import "@/styles/chessgroundBaseOverride.css";
import "@/styles/chessgroundColorsOverride.css";

import "@mantine/charts/styles.css";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/tiptap/styles.css";

import "mantine-contextmenu/styles.css";
import "mantine-datatable/styles.css";

import "@/styles/global.css";

import { commands } from "./bindings";
import { handleDeepLink, openCommandLineFile } from "./utils/launch";

const colorSchemeManager = localStorageColorSchemeManager({
  key: "mantine-color-scheme",
});

import ErrorComponent from "@/components/ErrorComponent";
import { getDatabasesDir, getDocumentDir, getEnginesDir, getPuzzlesDir } from "@/utils/directories";
import { initUserAgent } from "@/utils/http";
import { enableTelemetry } from "@/utils/telemetry";
import { type LocalEngine, requiredEngineSettings } from "@/utils/engines";
import { unwrap } from "@/utils/unwrap";
import { runDiagnosticReview } from "@/utils/runDiagnosticReview";
import { routeTree } from "./routeTree.gen";

export type Dirs = {
  documentDir: string;
  databasesDir: string;
  enginesDir: string;
  puzzlesDir: string;
};

const router = createRouter({
  routeTree,
  defaultErrorComponent: ErrorComponent,
  context: {
    loadDirs: async () => {
      const store = getDefaultStore();

      const documentDir = await getDocumentDir();
      const databasesDir = await getDatabasesDir();
      const enginesDir = await getEnginesDir();
      const puzzlesDir = await getPuzzlesDir();

      if (!store.get(storedDocumentDirAtom)) {
        store.set(storedDocumentDirAtom, documentDir);
      }

      if (!store.get(storedDatabasesDirAtom)) {
        store.set(storedDatabasesDirAtom, databasesDir);
      }

      if (!store.get(storedEnginesDirAtom)) {
        store.set(storedEnginesDirAtom, enginesDir);
      }

      if (!store.get(storedPuzzlesDirAtom)) {
        store.set(storedPuzzlesDirAtom, puzzlesDir);
      }

      return {
        documentDir,
        databasesDir,
        enginesDir,
        puzzlesDir,
      } as Dirs;
    },
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const preloadReferenceDb = async (store: ReturnType<typeof getDefaultStore>) => {
  const referenceDb = store.get(referenceDbAtom);
  if (referenceDb) {
    info(`Preloading reference database: ${referenceDb}`);
    commands.preloadReferenceDb(referenceDb).catch((e: unknown) => {
      info(`Failed to preload reference database: ${e}`);
    });
  }
};

const bundledStockfishId = "bundled-stockfish-19";

const registerBundledStockfish = async (store: ReturnType<typeof getDefaultStore>) => {
  try {
    const path = unwrap(await commands.getBundledEnginePath());
    const engines = store.get(enginesAtom) ?? [];
    if (engines.some((engine) => engine.type === "local" && engine.path === path)) return;

    const config = unwrap(await commands.getEngineConfig(path));
    const bundledEngine: LocalEngine = {
      type: "local",
      id: bundledStockfishId,
      name: config.name || "Stockfish 19",
      version: "19",
      path,
      image: "",
      loaded: true,
      settings: config.options
        .filter((option) => requiredEngineSettings.includes(option.value.name))
        .map((option) => ({
          name: option.value.name,
          value: "default" in option.value ? (option.value.default?.toString() ?? "") : "",
        })),
    };
    store.set(enginesAtom, [...engines, bundledEngine]);
    info(`Registered bundled Stockfish from ${path}`);
  } catch (error) {
    warn(`Bundled Stockfish is unavailable: ${error}`);
  }
};

const navigateToBoard = () => router.navigate({ to: "/" });

function useAppStartup() {
  const initialized = useRef(false);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const startupSequence = async () => {
      await initUserAgent();

      const detach = await attachConsole();
      info("React app started successfully");

      const store = getDefaultStore();
      await registerBundledStockfish(store);

      let cliMatches: Awaited<ReturnType<typeof getMatches>> | undefined;
      try {
        cliMatches = await getMatches();
      } catch (e) {
        warn(`Failed to parse CLI args: ${e}`);
      }

      const reviewUrl = cliMatches?.args["review-url"];
      if (reviewUrl?.occurrences && typeof reviewUrl.value === "string") {
        const output = cliMatches?.args["report-output"]?.value;
        try {
          const result = await runDiagnosticReview(
            reviewUrl.value,
            typeof output === "string" ? output : undefined,
          );
          info(`Diagnostic report status: ${result.status}`);
          info(`Diagnostic JSON: ${result.jsonPath}`);
          info(`Diagnostic Markdown: ${result.markdownPath}`);
          await exit(result.status === "complete" ? 0 : 1);
        } catch (e) {
          warn(`Diagnostic report could not be written: ${e}`);
          await exit(1);
        }
        return () => {
          if (detach) detach();
        };
      }

      await commands.closeSplashscreen();
      const telemetryEnabled = store.get(telemetryEnabledAtom);
      if (telemetryEnabled) {
        await enableTelemetry();
      }
      const unlistenFile = await listen<string>("open-cli-file", ({ payload }) => {
        void openCommandLineFile(payload, setTabs, setActiveTab, navigateToBoard);
      });

      const fileArg = cliMatches?.args.file;
      if (fileArg && fileArg.occurrences > 0) {
        info(`Opening file from command line: ${fileArg.value}`);
        if (typeof fileArg.value === "string") {
          const file = fileArg.value;
          await openCommandLineFile(file, setTabs, setActiveTab, navigateToBoard);
        }
      }

      await preloadReferenceDb(store);

      let unlistenDeepLink: (() => void) | undefined;
      try {
        const initialUrls = await getCurrent();
        if (initialUrls && initialUrls.length > 0) {
          for (const url of initialUrls) {
            void handleDeepLink(url, setTabs, setActiveTab, navigateToBoard);
          }
        }

        unlistenDeepLink = await onOpenUrl((urls) => {
          for (const url of urls) {
            void handleDeepLink(url, setTabs, setActiveTab, navigateToBoard);
          }
        });
      } catch (e) {
        warn(`Failed to setup deep links: ${e}`);
      }

      return () => {
        unlistenFile();
        if (detach) detach();
        if (unlistenDeepLink) unlistenDeepLink();
      };
    };

    let detachFn: (() => void) | undefined;
    startupSequence().then((fn) => {
      detachFn = fn;
    });

    return () => {
      if (detachFn) detachFn();
    };
  }, [setTabs, setActiveTab]);
}

export default function App() {
  const primaryColor = useAtomValue(primaryColorAtom);
  const pieceSet = useAtomValue(pieceSetAtom);
  const fontSize = useAtomValue(fontSizeAtom);
  const spellCheck = useAtomValue(spellCheckAtom);
  const is3d = useAtomValue(is3dAtom);
  const setDatabaseConversionState = useSetAtom(databaseConversionStateAtom);

  useAppStartup();

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}%`;
  }, [fontSize]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<[number, number, string | null]>("convert_progress", (event) => {
      const [totalGames, elapsedMs, sourceFileName] = event.payload;
      setDatabaseConversionState((prev) => ({
        ...prev,
        inProgress: true,
        totalGames,
        elapsedSeconds: elapsedMs / 1000,
        sourceFileName: sourceFileName ?? prev.sourceFileName,
      }));
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [setDatabaseConversionState]);

  const theme = createTheme({
    primaryColor,
    colors: {
      dark: [
        "#C1C2C5",
        "#A6A7AB",
        "#909296",
        "#5c5f66",
        "#373A40",
        "#2C2E33",
        "#25262b",
        "#1A1B1E",
        "#141517",
        "#101113",
      ],
    },
    components: {
      ActionIcon: ActionIcon.extend({
        defaultProps: {
          variant: "transparent",
          color: "gray",
        },
      }),
      TextInput: TextInput.extend({ defaultProps: { spellCheck } }),
      Autocomplete: Autocomplete.extend({ defaultProps: { spellCheck } }),
      Textarea: Textarea.extend({ defaultProps: { spellCheck } }),
      Input: Input.extend({
        defaultProps: {
          // @ts-expect-error - Solve mantine input type check
          spellCheck,
        },
      }),
    },
  });

  const valid3dPieceSets = [
    "Basic",
    "CubesAndPi",
    "Experimental",
    "Glass",
    "Metal",
    "ModernJade",
    "ModernWood",
    "RedVBlue",
    "Staunton",
    "Trimmed",
    "Wood",
  ];

  const getPieceSet = (pieceSet: string, is3d: boolean) => {
    if (is3d && !valid3dPieceSets.includes(pieceSet)) {
      return "Staunton";
    }
    return pieceSet;
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <link
        rel="stylesheet"
        href={`/pieces${is3d ? "-3d" : ""}/${getPieceSet(pieceSet, is3d)}.css`}
      />

      <MantineProvider
        colorSchemeManager={colorSchemeManager}
        defaultColorScheme="dark"
        theme={theme}
      >
        <ContextMenuProvider>
          <Notifications />
          <RouterProvider router={router} />
        </ContextMenuProvider>
      </MantineProvider>
    </DndProvider>
  );
}
