import { describe, expect, test } from "vitest";
import {
  allocateAdaptiveTimes,
  applyProfileEngineOverrides,
  chooseBenchmarkThreads,
  getAutoHashMb,
  getBenchmarkFingerprint,
  getThreadCandidates,
  profileBudgetMs,
} from "./performance";

const caps = { logicalCores: 8, totalMemoryBytes: 16 * 1024 ** 3, availableMemoryBytes: 8 * 1024 ** 3 };

describe("review performance planning", () => {
  test("reserves CPU capacity on low- and high-core machines", () => {
    expect(getThreadCandidates(2)).toEqual([1]);
    expect(getThreadCandidates(16)).toEqual([1, 7, 14]);
    expect(getThreadCandidates(16, 8)).toEqual([1, 7]);
    expect(getThreadCandidates(4, 8, 2)).toEqual([2, 3]);
  });

  test("caps hash by available RAM, total RAM, and one gigabyte", () => {
    expect(getAutoHashMb(caps)).toBe(1024);
    expect(getAutoHashMb({ logicalCores: 2, totalMemoryBytes: 2 * 1024 ** 3, availableMemoryBytes: 256 * 1024 ** 2 })).toBe(32);
    expect(getAutoHashMb(undefined)).toBe(64);
  });

  test("invalidates a benchmark when engine or hardware profile changes", () => {
    const first = getBenchmarkFingerprint("C:/sf.exe", "Stockfish 17", caps);
    expect(getBenchmarkFingerprint("C:/sf.exe", "Stockfish 17", caps)).toBe(first);
    expect(getBenchmarkFingerprint("C:/other.exe", "Stockfish 17", caps)).not.toBe(first);
    expect(getBenchmarkFingerprint("C:/sf.exe", "Stockfish 17", { ...caps, logicalCores: 4 })).not.toBe(first);
  });

  test("chooses the lowest candidate within 90% of peak", () => {
    expect(chooseBenchmarkThreads({ engineName: "Stockfish", candidates: [
      { threads: 1, medianNps: 900, medianDepth: 15 },
      { threads: 4, medianNps: 1000, medianDepth: 16 },
      { threads: 8, medianNps: 1100, medianDepth: 16 },
    ] })).toBe(4);
  });

  test("uses requested whole-game preset budgets", () => {
    expect(profileBudgetMs("fast", 80)).toBe(30_000);
    expect(profileBudgetMs("balanced", 80)).toBe(90_000);
    expect(profileBudgetMs("deep", 80)).toBe(300_000);
    expect(profileBudgetMs("custom", 80)).toBeNull();
  });

  test("keeps Custom engine overrides intact and does not mutate shared settings", () => {
    const settings = [{ name: "Threads", value: "6" }, { name: "Hash", value: "768" }, { name: "UCI_Chess960", value: "false" }];
    expect(applyProfileEngineOverrides(settings, "custom", 6, 768)).toEqual(settings);
    expect(settings[0]?.value).toBe("6");
    expect(applyProfileEngineOverrides(settings, "custom", 2, 128)).toEqual([
      { name: "Threads", value: "2" },
      { name: "Hash", value: "128" },
      { name: "UCI_Chess960", value: "false" },
    ]);
    expect(applyProfileEngineOverrides(settings, "balanced", 3, 256)).toEqual([
      { name: "Threads", value: "3" },
      { name: "Hash", value: "256" },
      { name: "UCI_Chess960", value: "false" },
    ]);
  });

  test("allocates a baseline to every position and redistributes beyond caps", () => {
    const result = allocateAdaptiveTimes(10_000, [1, 10, 1]);
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(10_000);
    expect(result.every((value) => value >= 1)).toBe(true);
    expect(result[1]).toBeGreaterThan(result[0]!);
  });
});
