/**
 * One index refresh at a time PER MACHINE (17/11/2026). Every open session
 * fires the Stop hook at each end of turn; without this, N sessions rebuilt
 * the same file side by side, each on every core.
 *
 * Lives in the plugin data directory, not in the hub: the hub lock (lock.ts)
 * guards git operations and holding it for minutes would block every other
 * session's commit.
 */
/** `pid` is null for a lock file caught between its creation and its write. */
export interface RefreshLockHolder {
    pid: number | null;
    acquiredAt: string;
}
export type RefreshLockResult = {
    acquired: true;
} | {
    acquired: false;
    heldByPid: number | null;
    since: string;
};
export type LockedRun<T> = {
    ran: true;
    value: T;
} | {
    ran: false;
    heldByPid: number | null;
    since: string;
};
export declare function refreshLockPath(pluginDataDir: string): string;
export declare function takeoverMarkerPath(pluginDataDir: string): string;
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
export declare function takeOverStaleLock(pluginDataDir: string, observed: RefreshLockHolder, pid: number, now: Date): boolean;
/**
 * Not re-entrant on purpose: a process asking twice means two refreshes.
 * `maxAgeMs` must exceed the refresh's own time ceiling, so that a lock this
 * old can only belong to a frozen process or a recycled PID.
 */
export declare function acquireRefreshLock(pluginDataDir: string, maxAgeMs: number, now?: Date, pid?: number): RefreshLockResult;
export declare function releaseRefreshLock(pluginDataDir: string, pid?: number): void;
export declare function withRefreshLock<T>(pluginDataDir: string, maxAgeMs: number, work: () => Promise<T>): Promise<LockedRun<T>>;
