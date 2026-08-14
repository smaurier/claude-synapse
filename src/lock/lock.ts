/**
 * Whole-repo lock (problème 3, 13/08) — covers memory AND the shared config
 * (problème 2's config lives in the same hub repo, same risk of concurrent
 * overwrite). Granularity is deliberately the whole repo, not per-file: the
 * corpus size doesn't justify the complexity of a finer lock.
 *
 * The lock file itself lives inside the hub (.synapse/.sync-lock) so it
 * travels with push/pull like everything else — no external coordination
 * service needed.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface LockFile {
  machineId: string;
  acquiredAt: string; // ISO 8601
}

export type AcquireResult =
  | { acquired: true }
  | { acquired: false; heldBy: string; since: string };

function lockPath(hubDir: string): string {
  return join(hubDir, ".synapse", ".sync-lock");
}

function readLock(hubDir: string): LockFile | null {
  const path = lockPath(hubDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as LockFile;
}

function writeLock(hubDir: string, machineId: string, at: Date): void {
  const path = lockPath(hubDir);
  // A freshly cloned hub (bootstrap's first machine) has no .synapse/ yet —
  // found 14/08 wiring the lock into bootstrap.ts, masked until then because
  // lock.test.ts's fixture always pre-created the directory.
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ machineId, acquiredAt: at.toISOString() }, null, 2), "utf8");
}

/**
 * Attempts to acquire the whole-repo lock.
 * - No lock present -> acquired.
 * - Lock owned by the SAME machine -> re-acquired (retry-safe).
 * - Lock owned by another machine, but older than timeoutMinutes -> reclaimed
 *   (a crashed machine must never block the other one forever).
 * - Lock owned by another machine, still fresh -> refused.
 */
export function acquireLock(
  hubDir: string,
  machineId: string,
  timeoutMinutes: number,
  now: Date = new Date(),
): AcquireResult {
  const existing = readLock(hubDir);

  if (!existing || existing.machineId === machineId) {
    writeLock(hubDir, machineId, now);
    return { acquired: true };
  }

  const ageMs = now.getTime() - new Date(existing.acquiredAt).getTime();
  if (ageMs > timeoutMinutes * 60_000) {
    writeLock(hubDir, machineId, now);
    return { acquired: true };
  }

  return { acquired: false, heldBy: existing.machineId, since: existing.acquiredAt };
}

/**
 * Releases the lock — but ONLY if it's currently held by machineId. A safe
 * no-op otherwise (no lock present, or held by someone else): releasing a
 * lock you don't hold would mean stealing a still-valid lock from another
 * machine, exactly what the lock exists to prevent.
 */
export function releaseLock(hubDir: string, machineId: string): void {
  const existing = readLock(hubDir);
  if (existing && existing.machineId === machineId) {
    unlinkSync(lockPath(hubDir));
  }
}
