# Chess Reviewer

Chess Reviewer is a local-first desktop application adapted from En Croissant. Windows and macOS builds include Stockfish. Import a PGN, run a Game Report, and read offline Vietnamese commentary for the main line. Human notes and generated commentary remain separate.

## Run from source

Requirements: Windows, the project's Node.js/pnpm version, Rust MSVC, Microsoft C++ Build Tools/Windows SDK, and WebView2.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open a PGN using the file-open action. The Windows installer includes Stockfish 19, and the universal macOS DMG includes the official Stockfish 19 macOS binary. The application validates the engine's UCI handshake and registers it automatically at startup. Game Review therefore does not require Node.js, Rust, Python, or a separately installed chess engine. You may still add another UCI engine in Settings if desired.

On macOS, open the DMG and drag `ChessReview.app` to Applications. Beta builds are not notarized, so Gatekeeper may require Control-click > Open the first time.

With an engine configured, open Game Report, select the engine and analysis level, and run the report. Generated commentary appears at the corresponding report node. PGN export preserves human notes and adds generated commentary with a re-importable marker.

## Privacy and scope

- Offline templates generate commentary. The commentary flow does not send PGN, FEN, or game positions to a service.
- Telemetry is off by default and starts only after the user enables it in Settings.
- Patzer is not a runtime dependency. Only a small, attributed TypeScript subset is used locally; no Patzer server, Ollama, or Docker runtime is used.
- The Rust OpenAI client is preparation only: it has no UI, key storage, Tauri command, or automatic request path.
- Some inherited En Croissant features may access online services only when explicitly used by the user.

## Validation and packaging

```powershell
pnpm test
pnpm lint
pnpm build-vite
pnpm build:installer
```

### Headless Chess.com review export

To run the same PGN import, local Stockfish report, and offline commentary pipeline without opening the app window, close any running Chess Review instance and run:

```powershell
pnpm review:link --review-url "https://www.chess.com/game/live/123456789" --report-output "$env:USERPROFILE\Desktop\chess-review"
```

The command writes `chess-review.json` (full engine data, per-move contexts, facts, and generated commentary) and `chess-review.md` (a readable summary) next to the requested output stem. If `--report-output` is omitted, both files are written to Downloads. This diagnostic mode uses the saved Report-panel engine and settings, performs the Chess.com fetch over the network, runs Stockfish locally, and exits with a non-zero code if the review fails. It does not save the imported game or generated comments into the user's game tabs. Close the normal app first because the single-instance handler forwards new launches to an existing window.

`pnpm build:installer` downloads the pinned official Windows Stockfish 19 release, verifies its SHA-256 checksum, builds an NSIS installer, and writes `ChessReview_1.0.0_Setup.exe` to `src-tauri/target/release/bundle/nsis`. The installer includes the WebView2 bootstrapper setup, Start Menu shortcut, uninstaller, and the `ChessReview.exe` application binary. On macOS, `pnpm build:mac-dmg` downloads and verifies the official universal Stockfish 19 binary, then builds a universal Intel + Apple Silicon DMG. See [implementation notes](docs/IMPLEMENTATION_NOTES.md) for the architecture and verification limits, and [license notices](docs/LICENSE_NOTICES.md) for upstream attribution.

## License

This fork remains licensed under GPL-3.0-only. See [LICENSE](LICENSE) and [license notices](docs/LICENSE_NOTICES.md).
