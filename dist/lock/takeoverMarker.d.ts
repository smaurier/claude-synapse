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
/** Runs `takeOver` alone under the marker. False, without running it, when
 *  another process is already taking over. */
export declare function underTakeoverMarker(markerPath: string, now: Date, takeOver: () => boolean): boolean;
