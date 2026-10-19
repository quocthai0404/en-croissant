import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const version = "19";
const archiveUrl =
  "https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip";
const expectedSha256 = "3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7";
const output = join("src-tauri", "resources", "stockfish", "stockfish.exe");
const temporaryDirectory = join("src-tauri", "resources", ".stockfish-download");
const archive = join(temporaryDirectory, `stockfish-${version}.zip`);
const extracted = join(temporaryDirectory, "extracted");

const quotePowerShell = (value) => `'${value.replaceAll("'", "''")}'`;

async function findEngine(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findEngine(path);
      if (nested) return nested;
    } else if (/^stockfish.*\.exe$/i.test(entry.name)) {
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

try {
  console.log(`Downloading Stockfish ${version} from the official release…`);
  const response = await fetch(archiveUrl);
  if (!response.ok) throw new Error(`Stockfish download failed: HTTP ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error("Stockfish download checksum does not match the official release.");
  }
  await writeFile(archive, bytes);

  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Expand-Archive -LiteralPath ${quotePowerShell(archive)} -DestinationPath ${quotePowerShell(extracted)} -Force`,
  ]);

  const engine = await findEngine(extracted);
  if (!engine) throw new Error("The official Stockfish archive did not contain a Windows executable.");
  await rename(engine, output);
  console.log(`Bundled Stockfish ${version}: ${output}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
