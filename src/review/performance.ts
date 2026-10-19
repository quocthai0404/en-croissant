import type { EngineBenchmarkResult, SystemCapabilities } from "@/bindings";

type CapabilityValue = number | bigint;
type CapabilityInput = Omit<SystemCapabilities, "totalMemoryBytes" | "availableMemoryBytes"> & {
  totalMemoryBytes: CapabilityValue;
  availableMemoryBytes: CapabilityValue;
};

export type ReviewProfile = "auto" | "fast" | "balanced" | "deep" | "custom";

export interface BenchmarkSnapshot {
  fingerprint: string;
  threads: number;
  hashMb: number;
  result: EngineBenchmarkResult;
  createdAt: number;
}

export function applyProfileEngineOverrides(
  settings: Array<{ name: string; value: string }>,
  profile: ReviewProfile,
  threads: number,
  hashMb: number,
): Array<{ name: string; value: string }> {
  return settings.map((setting) => {
    if (setting.name.toLowerCase() === "threads") return { ...setting, value: String(threads) };
    if (setting.name.toLowerCase() === "hash") return { ...setting, value: String(hashMb) };
    return { ...setting };
  });
}

export function getThreadCandidates(
  logicalCores: number,
  maxThreads = Number.MAX_SAFE_INTEGER,
  minThreads = 1,
): number[] {
  const cores = Math.max(1, Math.floor(logicalCores));
  const reserved = cores <= 8 ? 1 : 2;
  const usable = Math.max(1, cores - reserved);
  const minimum = Math.max(1, Math.floor(minThreads));
  const maximum = Math.max(minimum, Math.floor(maxThreads));
  const candidates = [...new Set([1, Math.max(1, Math.round(usable / 2)), usable])]
    .filter((threads) => threads >= minimum && threads <= maximum)
    .sort((a, b) => a - b);
  return candidates.length > 0 ? candidates : [minimum];
}

function floorPowerOfTwo(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 0;
  return 2 ** Math.floor(Math.log2(value));
}

export function getAutoHashMb(capabilities: CapabilityInput | null | undefined): number {
  if (
    !capabilities ||
    Number(capabilities.availableMemoryBytes) <= 0 ||
    Number(capabilities.totalMemoryBytes) <= 0
  ) {
    return 64;
  }
  const available = Number(capabilities.availableMemoryBytes);
  const total = Number(capabilities.totalMemoryBytes);
  const ceilingBytes = Math.min(
    available * 0.15,
    total * 0.1,
    1024 * 1024 * 1024,
  );
  const mb = floorPowerOfTwo(ceilingBytes / (1024 * 1024));
  return Math.max(1, mb || 1);
}

export function getBenchmarkFingerprint(
  enginePath: string,
  engineIdentity: string,
  capabilities: CapabilityInput,
): string {
  return [
    enginePath.trim().toLowerCase(),
    engineIdentity.trim().toLowerCase(),
    capabilities.logicalCores,
    Math.floor(Number(capabilities.totalMemoryBytes) / (1024 * 1024)),
  ].join("|");
}

export function chooseBenchmarkThreads(result: EngineBenchmarkResult): number | null {
  const candidates = result.candidates.filter((candidate) => candidate.threads > 0 && candidate.medianNps > 0);
  if (candidates.length === 0) return null;
  const peak = Math.max(...candidates.map((candidate) => candidate.medianNps));
  return candidates
    .filter((candidate) => candidate.medianNps >= peak * 0.9)
    .sort((a, b) => a.threads - b.threads)[0]?.threads ?? null;
}

export function profileBudgetMs(profile: ReviewProfile, mainlinePlyCount: number): number | null {
  if (profile === "custom") return null;
  const typicalBudget = profile === "fast" ? 30_000 : profile === "deep" ? 300_000 : 90_000;
  const scale = Math.min(1.25, Math.max(0.25, mainlinePlyCount / 80));
  return Math.round(typicalBudget * scale);
}

/** Allocate a fixed total budget while guaranteeing every position a baseline. */
export function allocateAdaptiveTimes(totalMs: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const total = Math.max(weights.length, Math.floor(totalMs));
  const baseline = Math.max(1, Math.floor(total / weights.length / 2));
  const allocation = weights.map(() => baseline);
  let remaining = total - baseline * weights.length;
  const caps = weights.map(() => baseline * 4);
  const safeWeights = weights.map((weight) => Math.max(1, Number.isFinite(weight) ? weight : 1));

  while (remaining > 0) {
    const eligible = allocation.map((value, index) => (value < caps[index]! ? index : -1)).filter((index) => index >= 0);
    if (eligible.length === 0) {
      const extra = Math.floor(remaining / weights.length);
      allocation.forEach((_, index) => {
        allocation[index]! += extra;
      });
      remaining -= extra * weights.length;
      if (remaining > 0) {
        allocation[0]! += remaining;
        remaining = 0;
      }
      break;
    }
    const eligibleWeight = eligible.reduce((sum, index) => sum + safeWeights[index]!, 0);
    let distributed = 0;
    for (const index of eligible) {
      const share = Math.max(1, Math.floor((remaining * safeWeights[index]!) / eligibleWeight));
      const amount = Math.min(share, caps[index]! - allocation[index]!, remaining - distributed);
      if (amount > 0) {
        allocation[index]! += amount;
        distributed += amount;
      }
      if (distributed >= remaining) break;
    }
    if (distributed === 0) break;
    remaining -= distributed;
  }
  return allocation;
}

export function derivePositionWeights(
  scores: Array<number | null>,
  playedMoveIsBest: boolean[],
  hasVerifiedTactic: boolean[],
  hasMateTransition: boolean[],
): number[] {
  return scores.map((score, index) => {
    let weight = 1;
    const next = scores[index + 1];
    if (score !== null && next !== undefined && next !== null && Math.abs(next - score) >= 100) weight += 2;
    if (playedMoveIsBest[index] === false) weight += 2;
    if (hasVerifiedTactic[index]) weight += 3;
    if (hasMateTransition[index]) weight += 6;
    return weight;
  });
}
