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
 * (flag "wx"), so two processes racing on an absent lock can't both win,
 * and replacing a stale lock goes through a takeover marker (18/11/2026,
 * see takeoverMarker.ts), so two processes reclaiming it can't both win.
 */
import { mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { underTakeoverMarker } from "./takeoverMarker.js";
/** Holder of a lock file caught between its atomic creation and its write. */
const UNREADABLE_HOLDER = "inconnu (verrou en cours d'écriture)";
function lockPath(hubDir) {
    return join(hubDir, ".synapse", ".sync-lock");
}
/** Must stay ignored by the hub's git (hubGitignore.ts). */
export function syncLockTakeoverPath(hubDir) {
    return join(hubDir, ".synapse", ".sync-lock.takeover");
}
/** An unreadable file is a lock still being written: its age comes from the
 *  file itself and its holder is unknown, so it is never reclaimed at once. */
function readLock(hubDir) {
    const path = lockPath(hubDir);
    try {
        const raw = readFileSync(path, "utf8");
        try {
            return JSON.parse(raw);
        }
        catch {
            return { machineId: UNREADABLE_HOLDER, acquiredAt: statSync(path).mtime.toISOString() };
        }
    }
    catch (err) {
        if (err.code === "ENOENT")
            return null;
        throw err;
    }
}
function isSameLock(a, b) {
    return a.machineId === b.machineId && a.pid === b.pid && a.acquiredAt === b.acquiredAt;
}
/** Atomic create: false if a lock file already exists. */
function tryCreateLock(hubDir, machineId, pid, at) {
    const path = lockPath(hubDir);
    // A freshly cloned hub (bootstrap's first machine) has no .synapse/ yet.
    mkdirSync(dirname(path), { recursive: true });
    try {
        writeFileSync(path, JSON.stringify({ machineId, pid, acquiredAt: at.toISOString() }, null, 2), {
            encoding: "utf8",
            flag: "wx",
        });
        return true;
    }
    catch (err) {
        if (err.code === "EEXIST")
            return false;
        throw err;
    }
}
export function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        // EPERM: the process exists, we just may not signal it.
        return err.code === "EPERM";
    }
}
function describeHolder(lock) {
    return lock.pid === undefined ? lock.machineId : `${lock.machineId} (pid ${lock.pid})`;
}
function isReclaimable(existing, machineId, timeoutMinutes, now) {
    const ageMs = now.getTime() - new Date(existing.acquiredAt).getTime();
    if (ageMs > timeoutMinutes * 60_000)
        return true; // a crashed holder must never block forever
    if (existing.machineId !== machineId)
        return false; // can't see another machine's processes
    return existing.pid === undefined || !isProcessAlive(existing.pid);
}
/** Replaces the stale lock `observed`, one process at a time: under the
 *  marker, the lock is read again and only replaced if it is still that one. */
export function takeOverStaleSyncLock(hubDir, observed, machineId, pid, now) {
    return underTakeoverMarker(syncLockTakeoverPath(hubDir), now, () => {
        const current = readLock(hubDir);
        if (current !== null) {
            if (!isSameLock(current, observed))
                return false;
            rmSync(lockPath(hubDir), { force: true });
        }
        return tryCreateLock(hubDir, machineId, pid, now);
    });
}
/**
 * Attempts to acquire the whole-repo lock.
 * - No lock present -> acquired (atomically).
 * - Held by this very process -> re-acquired (retry-safe).
 * - Held by a dead process of this machine, or a pre-pid lock of this
 *   machine -> reclaimed at once.
 * - Held by anyone for longer than timeoutMinutes -> reclaimed.
 * - Otherwise (live process here, or fresh lock from another machine) -> refused.
 */
export function acquireLock(hubDir, machineId, timeoutMinutes, now = new Date(), pid = process.pid) {
    if (tryCreateLock(hubDir, machineId, pid, now))
        return { acquired: true };
    const existing = readLock(hubDir);
    if (!existing) {
        // Released between our attempt and our read: one more atomic try.
        return tryCreateLock(hubDir, machineId, pid, now)
            ? { acquired: true }
            : { acquired: false, heldBy: "inconnu", since: now.toISOString() };
    }
    if (existing.machineId === machineId && existing.pid === pid)
        return { acquired: true };
    if (isReclaimable(existing, machineId, timeoutMinutes, now)) {
        if (takeOverStaleSyncLock(hubDir, existing, machineId, pid, now))
            return { acquired: true };
        const winner = readLock(hubDir);
        return { acquired: false, heldBy: winner ? describeHolder(winner) : "inconnu", since: winner?.acquiredAt ?? now.toISOString() };
    }
    return { acquired: false, heldBy: describeHolder(existing), since: existing.acquiredAt };
}
/** Same rules as acquireLock, but waits for a live holder to finish:
 *  two sessions ending together must queue, not drop one sync. */
export async function acquireLockWithRetry(hubDir, machineId, timeoutMinutes, { waitMs, intervalMs = 250 }) {
    const deadline = Date.now() + waitMs;
    for (;;) {
        const result = acquireLock(hubDir, machineId, timeoutMinutes);
        if (result.acquired || Date.now() >= deadline)
            return result;
        await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
    }
}
/**
 * Releases the lock, but ONLY if this process holds it. A safe no-op
 * otherwise: releasing a lock you don't hold would mean stealing a
 * still-valid lock, exactly what the lock exists to prevent.
 */
export function releaseLock(hubDir, machineId, pid = process.pid) {
    const existing = readLock(hubDir);
    if (existing && existing.machineId === machineId && existing.pid === pid) {
        unlinkSync(lockPath(hubDir));
    }
}
//# sourceMappingURL=lock.js.map