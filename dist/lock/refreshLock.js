/**
 * One index refresh at a time PER MACHINE (17/11/2026). Every open session
 * fires the Stop hook at each end of turn; without this, N sessions rebuilt
 * the same file side by side, each on every core.
 *
 * Lives in the plugin data directory, not in the hub: the hub lock (lock.ts)
 * guards git operations and holding it for minutes would block every other
 * session's commit.
 */
import { mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isProcessAlive } from "./lock.js";
import { underTakeoverMarker } from "./takeoverMarker.js";
export function refreshLockPath(pluginDataDir) {
    return join(pluginDataDir, "refresh-index.lock");
}
export function takeoverMarkerPath(pluginDataDir) {
    return join(pluginDataDir, "refresh-index.lock.takeover");
}
function tryCreate(pluginDataDir, pid, at) {
    mkdirSync(pluginDataDir, { recursive: true });
    try {
        writeFileSync(refreshLockPath(pluginDataDir), JSON.stringify({ pid, acquiredAt: at.toISOString() }), {
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
/** `null` when there is no lock file. A file caught between its atomic
 *  creation and its write has no readable holder yet: its age comes from the
 *  file itself, so it is never mistaken for a stale lock. */
function readHolder(pluginDataDir) {
    const path = refreshLockPath(pluginDataDir);
    try {
        const raw = readFileSync(path, "utf8");
        try {
            const { pid, acquiredAt } = JSON.parse(raw);
            return { pid, acquiredAt };
        }
        catch {
            return { pid: null, acquiredAt: statSync(path).mtime.toISOString() };
        }
    }
    catch (err) {
        if (err.code === "ENOENT")
            return null;
        throw err;
    }
}
function isStale(holder, maxAgeMs, now) {
    if (now.getTime() - new Date(holder.acquiredAt).getTime() > maxAgeMs)
        return true;
    return holder.pid !== null && !isProcessAlive(holder.pid);
}
/** Replaces a stale lock, one process at a time (see takeoverMarker.ts). */
export function takeOverStaleLock(pluginDataDir, observed, pid, now) {
    return underTakeoverMarker(takeoverMarkerPath(pluginDataDir), now, () => {
        const current = readHolder(pluginDataDir);
        if (current !== null) {
            if (current.pid !== observed.pid || current.acquiredAt !== observed.acquiredAt)
                return false;
            rmSync(refreshLockPath(pluginDataDir), { force: true });
        }
        return tryCreate(pluginDataDir, pid, now);
    });
}
/**
 * Not re-entrant on purpose: a process asking twice means two refreshes.
 * `maxAgeMs` must exceed the refresh's own time ceiling, so that a lock this
 * old can only belong to a frozen process or a recycled PID.
 */
export function acquireRefreshLock(pluginDataDir, maxAgeMs, now = new Date(), pid = process.pid) {
    if (tryCreate(pluginDataDir, pid, now))
        return { acquired: true };
    const holder = readHolder(pluginDataDir);
    if (holder !== null && !isStale(holder, maxAgeMs, now)) {
        return { acquired: false, heldByPid: holder.pid, since: holder.acquiredAt };
    }
    const took = holder === null ? tryCreate(pluginDataDir, pid, now) : takeOverStaleLock(pluginDataDir, holder, pid, now);
    if (took)
        return { acquired: true };
    const winner = readHolder(pluginDataDir);
    return { acquired: false, heldByPid: winner?.pid ?? null, since: winner?.acquiredAt ?? now.toISOString() };
}
export function releaseRefreshLock(pluginDataDir, pid = process.pid) {
    if (readHolder(pluginDataDir)?.pid === pid)
        unlinkSync(refreshLockPath(pluginDataDir));
}
export async function withRefreshLock(pluginDataDir, maxAgeMs, work) {
    const lock = acquireRefreshLock(pluginDataDir, maxAgeMs);
    if (!lock.acquired)
        return { ran: false, heldByPid: lock.heldByPid, since: lock.since };
    try {
        return { ran: true, value: await work() };
    }
    finally {
        releaseRefreshLock(pluginDataDir);
    }
}
//# sourceMappingURL=refreshLock.js.map