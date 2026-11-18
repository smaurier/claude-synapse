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

interface RefreshLockFile {
  pid: number;
  acquiredAt: string; // ISO 8601
}

/** `pid` is null for a lock file caught between its creation and its write. */
export interface RefreshLockHolder {
  pid: number | null;
  acquiredAt: string;
}

export type RefreshLockResult =
  | { acquired: true }
  | { acquired: false; heldByPid: number | null; since: string };

export type LockedRun<T> =
  | { ran: true; value: T }
  | { ran: false; heldByPid: number | null; since: string };

export function refreshLockPath(pluginDataDir: string): string {
  return join(pluginDataDir, "refresh-index.lock");
}

export function takeoverMarkerPath(pluginDataDir: string): string {
  return join(pluginDataDir, "refresh-index.lock.takeover");
}

function tryCreate(pluginDataDir: string, pid: number, at: Date): boolean {
  mkdirSync(pluginDataDir, { recursive: true });
  try {
    writeFileSync(refreshLockPath(pluginDataDir), JSON.stringify({ pid, acquiredAt: at.toISOString() }), {
      encoding: "utf8",
      flag: "wx",
    });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

/** `null` when there is no lock file. A file caught between its atomic
 *  creation and its write has no readable holder yet: its age comes from the
 *  file itself, so it is never mistaken for a stale lock. */
function readHolder(pluginDataDir: string): RefreshLockHolder | null {
  const path = refreshLockPath(pluginDataDir);
  try {
    const raw = readFileSync(path, "utf8");
    try {
      const { pid, acquiredAt } = JSON.parse(raw) as RefreshLockFile;
      return { pid, acquiredAt };
    } catch {
      return { pid: null, acquiredAt: statSync(path).mtime.toISOString() };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function isStale(holder: RefreshLockHolder, maxAgeMs: number, now: Date): boolean {
  if (now.getTime() - new Date(holder.acquiredAt).getTime() > maxAgeMs) return true;
  return holder.pid !== null && !isProcessAlive(holder.pid);
}

/** Replaces a stale lock, one process at a time (see takeoverMarker.ts). */
export function takeOverStaleLock(pluginDataDir: string, observed: RefreshLockHolder, pid: number, now: Date): boolean {
  return underTakeoverMarker(takeoverMarkerPath(pluginDataDir), now, () => {
    const current = readHolder(pluginDataDir);
    if (current !== null) {
      if (current.pid !== observed.pid || current.acquiredAt !== observed.acquiredAt) return false;
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
export function acquireRefreshLock(
  pluginDataDir: string,
  maxAgeMs: number,
  now: Date = new Date(),
  pid: number = process.pid,
): RefreshLockResult {
  if (tryCreate(pluginDataDir, pid, now)) return { acquired: true };

  const holder = readHolder(pluginDataDir);
  if (holder !== null && !isStale(holder, maxAgeMs, now)) {
    return { acquired: false, heldByPid: holder.pid, since: holder.acquiredAt };
  }

  const took = holder === null ? tryCreate(pluginDataDir, pid, now) : takeOverStaleLock(pluginDataDir, holder, pid, now);
  if (took) return { acquired: true };
  const winner = readHolder(pluginDataDir);
  return { acquired: false, heldByPid: winner?.pid ?? null, since: winner?.acquiredAt ?? now.toISOString() };
}

export function releaseRefreshLock(pluginDataDir: string, pid: number = process.pid): void {
  if (readHolder(pluginDataDir)?.pid === pid) unlinkSync(refreshLockPath(pluginDataDir));
}

export async function withRefreshLock<T>(
  pluginDataDir: string,
  maxAgeMs: number,
  work: () => Promise<T>,
): Promise<LockedRun<T>> {
  const lock = acquireRefreshLock(pluginDataDir, maxAgeMs);
  if (!lock.acquired) return { ran: false, heldByPid: lock.heldByPid, since: lock.since };
  try {
    return { ran: true, value: await work() };
  } finally {
    releaseRefreshLock(pluginDataDir);
  }
}
