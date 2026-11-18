/**
 * Replacing a stale lock file takes two steps, deleting it then creating
 * one's own. Without serialization, a process that read the stale lock a
 * moment earlier deleted the fresh lock of whoever took over first, then
 * created its own: measured on the refresh lock (17/11/2026, three to eight
 * holders out of eight processes started together) and on the hub lock
 * (18/11/2026, two to seven). Shared by both locks.
 *
 * The marker is created exclusively, so one process at a time re-reads the
 * lock and replaces it only if it is still the one it saw stale.
 *
 * Residual: a marker abandoned by a process killed mid-takeover is cleared
 * by age, and that clearing is not itself serialized.
 */

import { rmSync, statSync, writeFileSync } from "node:fs";

/** A takeover is a handful of synchronous file operations: a marker this old
 *  belongs to a process that died in the middle of one. */
const TAKEOVER_MAX_AGE_MS = 10_000;

function tryCreateMarker(markerPath: string): boolean {
  try {
    writeFileSync(markerPath, "", { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

function isAbandoned(markerPath: string, now: Date): boolean {
  try {
    return now.getTime() - statSync(markerPath).mtimeMs > TAKEOVER_MAX_AGE_MS;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }
}

function enter(markerPath: string, now: Date): boolean {
  if (tryCreateMarker(markerPath)) return true;
  if (!isAbandoned(markerPath, now)) return false;
  rmSync(markerPath, { force: true });
  return tryCreateMarker(markerPath);
}

/** Runs `takeOver` alone under the marker. False, without running it, when
 *  another process is already taking over. */
export function underTakeoverMarker(markerPath: string, now: Date, takeOver: () => boolean): boolean {
  if (!enter(markerPath, now)) return false;
  try {
    return takeOver();
  } finally {
    rmSync(markerPath, { force: true });
  }
}
