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
export type AcquireResult = {
    acquired: true;
} | {
    acquired: false;
    heldBy: string;
    since: string;
};
/**
 * Attempts to acquire the whole-repo lock.
 * - No lock present -> acquired.
 * - Lock owned by the SAME machine -> re-acquired (retry-safe).
 * - Lock owned by another machine, but older than timeoutMinutes -> reclaimed
 *   (a crashed machine must never block the other one forever).
 * - Lock owned by another machine, still fresh -> refused.
 */
export declare function acquireLock(hubDir: string, machineId: string, timeoutMinutes: number, now?: Date): AcquireResult;
/**
 * Releases the lock — but ONLY if it's currently held by machineId. A safe
 * no-op otherwise (no lock present, or held by someone else): releasing a
 * lock you don't hold would mean stealing a still-valid lock from another
 * machine, exactly what the lock exists to prevent.
 */
export declare function releaseLock(hubDir: string, machineId: string): void;
