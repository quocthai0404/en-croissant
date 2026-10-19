import { existsSync } from "node:fs";
import { copyFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const directory = join("src-tauri", "target", "release", "bundle", "nsis");
const finalName = "ChessReview_1.0.0_Setup.exe";
const finalPath = join(directory, finalName);

if (!existsSync(directory)) throw new Error(`NSIS output directory does not exist: ${directory}`);
const installers = (await readdir(directory)).filter(
  (name) => name.toLowerCase().endsWith(".exe") && name !== finalName,
);
if (installers.length !== 1) {
  throw new Error(`Expected one NSIS installer, found ${installers.length}: ${installers.join(", ")}`);
}

await rm(finalPath, { force: true });
await copyFile(join(directory, installers[0]), finalPath);
console.log(`Installer ready: ${finalPath}`);
