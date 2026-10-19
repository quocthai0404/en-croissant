import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const version = "19";
const platform = process.platform;
const engine =
  platform === "win32"
    ? {
        archiveName: `stockfish-${version}.zip`,
        archiveUrl:
          "https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip",
        expectedSha256: "3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7",
        output: join("src-tauri", "resources", "stockfish", "stockfish.exe"),
        match: /^stockfish.*\.exe$/i,
      }
    : platform === "darwin"
      ? {
          archiveName: `stockfish-macos-${version}.tar.gz`,
          archiveUrl:
            "https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-macos-universal.tar.gz",
          expectedSha256: "a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77",
          output: join("src-tauri", "resources", "stockfish", "stockfish-macos"),
          match: /^stockfish-macos-universal$/i,
        }
      : null;

if (!engine) {
  throw new Error(`Bundled Stockfish preparation is not configured for ${platform}.`);
}

const output = engine.output;
const temporaryDirectory = join("src-tauri", "resources", ".stockfish-download");
const archive = join(temporaryDirectory, engine.archiveName);
const extracted = join(temporaryDirectory, "extracted");

const quotePowerShell = (value) => `'${value.replaceAll("'", "''")}'`;

async function findEngine(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findEngine(path);
      if (nested) return nested;
    } else if (engine.match.test(entry.name)) {
      return path;
    }
  }
  return null;
}

if (existsSync(output)) {
  console.log(`Bundled Stockfish already exists: ${output}`);
  process.exit(0);
}

await mkdir(temporaryDirectory, { recursive: true });
await mkdir(dirname(output), { recursive: true });
await mkdir(extracted, { recursive: true });

try {
  console.log(`Downloading Stockfish ${version} for ${platform} from the official release…`);
  const response = await fetch(engine.archiveUrl);
  if (!response.ok) throw new Error(`Stockfish download failed: HTTP ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== engine.expectedSha256) {
    throw new Error("Stockfish download checksum does not match the official release.");
  }
  await writeFile(archive, bytes);

  if (platform === "win32") {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath ${quotePowerShell(archive)} -DestinationPath ${quotePowerShell(extracted)} -Force`,
    ]);
  } else {
    await execFileAsync("tar", ["-xzf", archive, "-C", extracted]);
  }

  const enginePath = await findEngine(extracted);
  if (!enginePath)
    throw new Error(
      `The official Stockfish archive did not contain the expected ${platform} executable.`,
    );
  await rename(enginePath, output);
  if (platform === "darwin") await chmod(output, 0o755);
  console.log(`Bundled Stockfish ${version} for ${platform}: ${output}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
