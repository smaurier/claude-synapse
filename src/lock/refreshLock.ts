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

interface RefreshLockFile {
  pid: number;
  acquiredAt: string; // ISO 8601
}

/** `pid` is null for a lock file caught between its creation and its write. */
export interface RefreshLockHolder {
  pid: number | null;
  acquiredAt: string;
}

/** A takeover is a handful of synchronous file operations: a marker this old
 *  belongs to a process that died in the middle of one. */
const TAKEOVER_MAX_AGE_MS = 10_000;

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

function tryCreateTakeoverMarker(pluginDataDir: string): boolean {
  try {
    writeFileSync(takeoverMarkerPath(pluginDataDir), "", { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

function isTakeoverAbandoned(pluginDataDir: string, now: Date): boolean {
  try {
    return now.getTime() - statSync(takeoverMarkerPath(pluginDataDir)).mtimeMs > TAKEOVER_MAX_AGE_MS;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }
}

function enterTakeover(pluginDataDir: string, now: Date): boolean {
  if (tryCreateTakeoverMarker(pluginDataDir)) return true;
  if (!isTakeoverAbandoned(pluginDataDir, now)) return false;
  rmSync(takeoverMarkerPath(pluginDataDir), { force: true });
  return tryCreateTakeoverMarker(pluginDataDir);
}

/**
 * Replaces a stale lock, one process at a time. Deleting the stale file and
 * creating one's own are two steps: without the marker, a process that read
 * the stale lock a moment earlier deleted the fresh lock of whoever took over
 * first, then created its own (measured 17/11/2026: three to eight holders
 * out of eight processes started together). Under the marker, the lock is
 * read again and only deleted if it is still the one seen stale.
 *
 * Residual: a marker abandoned by a process killed mid-takeover is cleared
 * by age, and that clearing is not itself serialized.
 */
export function takeOverStaleLock(pluginDataDir: string, observed: RefreshLockHolder, pid: number, now: Date): boolean {
  if (!enterTakeover(pluginDataDir, now)) return false;
  try {
    const current = readHolder(pluginDataDir);
    if (current !== null) {
      if (current.pid !== observed.pid || current.acquiredAt !== observed.acquiredAt) return false;
      unlinkSync(refreshLockPath(pluginDataDir));
    }
    return tryCreate(pluginDataDir, pid, now);
  } finally {
    rmSync(takeoverMarkerPath(pluginDataDir), { force: true });
  }
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
