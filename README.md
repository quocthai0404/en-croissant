# Chess Reviewer

Chess Reviewer is a Windows-first, local-first desktop application adapted from En Croissant. Import a PGN, run a Game Report with bundled Stockfish, and read offline Vietnamese commentary for the main line. Human notes and generated commentary remain separate.

## Run from source

Requirements: Windows, the project's Node.js/pnpm version, Rust MSVC, Microsoft C++ Build Tools/Windows SDK, and WebView2.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open a PGN using the file-open action. The Windows installer includes Stockfish 19 and the application validates its UCI handshake and registers it automatically at startup. Game Review therefore does not require Node.js, Rust, Python, or a separately installed chess engine. You may still add another UCI engine in Settings if desired.

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

`pnpm build:installer` downloads the pinned official Stockfish 19 release, verifies its SHA-256 checksum, builds an NSIS installer, and writes `ChessReview_1.0.0_Setup.exe` to `src-tauri/target/release/bundle/nsis`. The installer includes an offline WebView2 installer, Start Menu shortcut, uninstaller, and the `ChessReview.exe` application binary. See [implementation notes](docs/IMPLEMENTATION_NOTES.md) for the architecture and verification limits, and [license notices](docs/LICENSE_NOTICES.md) for upstream attribution.

## License

This fork remains licensed under GPL-3.0-only. See [LICENSE](LICENSE) and [license notices](docs/LICENSE_NOTICES.md).
