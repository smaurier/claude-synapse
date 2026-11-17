/**
 * Whole-repo lock (problème 3, 13/08): covers memory AND the shared config
 * (problème 2's config lives in the same hub repo, same risk of concurrent
 * overwrite). Granularity is deliberately the whole repo, not per-file: the
 * corpus size doesn't justify the complexity of a finer lock.
 *
 * The lock file lives inside the hub (.synapse/.sync-lock), gitignored.
 *
 * The holder is a PROCESS (machineId + pid), not a machine (15/11/2026):
 * two Claude sessions on the same machine share a machineId, and the old
 * "same machine re-acquires" rule handed the lock to both at once, then
 * whichever finished first released the other's lock. Creation is atomic
 * (flag "wx"), so two processes racing on an absent lock can't both win.
 */
export type AcquireResult = {
    acquired: true;
} | {
    acquired: false;
    heldBy: string;
    since: string;
};
export declare function isProcessAlive(pid: number): boolean;
/**
 * Attempts to acquire the whole-repo lock.
 * - No lock present -> acquired (atomically).
 * - Held by this very process -> re-acquired (retry-safe).
 * - Held by a dead process of this machine, or a pre-pid lock of this
 *   machine -> reclaimed at once.
 * - Held by anyone for longer than timeoutMinutes -> reclaimed.
 * - Otherwise (live process here, or fresh lock from another machine) -> refused.
 */
export declare function acquireLock(hubDir: string, machineId: string, timeoutMinutes: number, now?: Date, pid?: number): AcquireResult;
export interface RetryOptions {
    /** Total time to keep trying. 0 = a single attempt. */
    waitMs: number;
    intervalMs?: number;
}
/** Same rules as acquireLock, but waits for a live holder to finish:
 *  two sessions ending together must queue, not drop one sync. */
export declare function acquireLockWithRetry(hubDir: string, machineId: string, timeoutMinutes: number, { waitMs, intervalMs }: RetryOptions): Promise<AcquireResult>;
/**
 * Releases the lock, but ONLY if this process holds it. A safe no-op
 * otherwise: releasing a lock you don't hold would mean stealing a
 * still-valid lock, exactly what the lock exists to prevent.
 */
export declare function releaseLock(hubDir: string, machineId: string, pid?: number): void;
