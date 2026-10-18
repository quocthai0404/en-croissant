# Implementation notes

## Sources and licenses

- Chess Reviewer is adapted from En Croissant `0.15.1`, commit `a91f32b1c57eb93acad92f9778205eac7b4345d9`, licensed GPL-3.0-only.
- Patzer `7.18.1`, commit `f21b32c81189c10a318397076cbd015f5b458973`, is MIT licensed and was audited as source material only. Its server, web bundle, Docker configuration, and models are not runtime dependencies.
- `src/commentary/vendor/patzer-tactics.ts` is a selected, attributed adaptation of `server/src/coach/tactics.ts`. Its motifs are candidates, never proof of a material win. `chess.js` `1.4.0` validates chess rules.

See [LICENSE_NOTICES.md](LICENSE_NOTICES.md) for attribution details.

## Review pipeline

The existing pipeline is `ReportModal → commands.analyzeGame → addAnalysis → TreeNode → ReportPanel`. Game-tree state persists through the existing store and uses the existing PGN lexer and serializer. `analyzeGame` receives the starting FEN and mainline UCI moves; `addAnalysis` applies scores, annotations, and optional engine variations. Engine scores are normalized to White's perspective.

Native analysis is joined to the parent-to-child move edge. SAN is replayed with `chess.js`; its result must agree on board, side to move, castling rights, and en-passant state before a commentary context is created. Ply is derived from the FEN fullmove number and side to move. Invalid edges are skipped instead of breaking game navigation.

Post-processing is tied to a request token, tab, and tree fingerprint. Cancelling, changing tabs, or unmounting invalidates stale work and invokes the existing cancellation API. Commentary is generated only for the main line.

## Offline commentary

- `MoveContext` carries pre/post FEN, SAN, moving side, report score/annotation/best line, stable game ID, and ply.
- `ChessFact` declares source and confidence. Captures, checks, mates, castling, and development use legal move replay. Fork and hanging-piece signals remain heuristic.
- The geometry adapter reports a newly opened attack ray only when replay proves that the blocker moved, the ray is clear, and the follow-up capture is legal. The regression for `23.c4 → 23...Bxb2` identifies White's pawn leaving c3, Black's bishop opening the g7–b2 diagonal, and the legal capture of White's queen.
- Templates are Vietnamese-only and offline. Ordinary moves receive one neutral sentence; important moves receive a concise cause, consequence, and lesson without invented plans.
- `TreeNode.generatedComment` is versioned metadata independent of the human `TreeNode.comment`. Regeneration replaces only generated content. PGN export uses a namespaced marker so import restores generated metadata without overwriting human notes.

The Report panel marks automatic commentary clearly. If no engine is configured, the report flow guides the user to choose a Stockfish `.exe`; the UCI configuration check has a ten-second timeout.

## Native OpenAI preparation

`src-tauri/src/openai_commentary.rs` is an isolated Rust module. It is not a Tauri command and is never invoked by the renderer. A future native caller must supply its API key, model, and normalized payload. The client uses the Responses API with strict JSON Schema, `store: false`, a 45-second timeout, and classified errors.

The request includes no PGN. A response is rejected if its JSON, fact IDs, SAN, squares, or color assignments do not match the supplied facts. Production uses HTTPS only; tests may substitute a mock endpoint. No key appears in frontend state, logs, PGN, or documentation.

## Fork behavior and verification limit

The Tauri product uses the Chess Reviewer name and identifier. The upstream updater key and endpoint are removed so this fork cannot download upstream binaries. Stockfish is never bundled; the user supplies an external executable. Docker is intentionally not used for this Windows GUI.

The native Tauri build could not be completed in this environment because the Windows MSVC toolchain is missing `msvcrt.lib`. End-to-end GUI review with Stockfish, installer generation, and clean-machine installation still require verification on a machine with a complete MSVC toolchain.
