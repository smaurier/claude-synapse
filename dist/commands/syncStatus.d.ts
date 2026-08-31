/**
 * /synapse-sync-status — quick, read-only view of which watched repos are
 * ahead / behind / diverged from their remotes. Runs at SessionStart to catch
 * silent divergences (like the one that let a diagnostic-pre-evaluation.md
 * sleep on the remote unpulled for three weeks). Zero automatic action —
 * signal only, decision stays with the user.
 *
 * Repos to watch come from the union of three sources (harnass):
 *   1. explicit list in sync-watch.json
 *   2. scanPaths: any directory of depth 1 under the given root that has .git
 *   3. fromMemory: URLs found in MEMORY.md (github.com/<user>/<repo>) mapped
 *      to local clones when discoverable
 * A blacklist removes noisy or archived repos from the final list.
 *
 * The C-hybrid latency strategy: read cache when younger than CACHE_TTL_MS,
 * otherwise git fetch (bounded per-repo timeout, parallel). Cache lives next
 * to the config in the plugin data directory.
 */
export type RepoStatus = "ok" | "ahead" | "behind" | "diverged" | "error";
export interface WatchEntry {
    name: string;
    path: string;
}
export interface WatchConfig {
    explicit: WatchEntry[];
    scanPaths: string[];
    fromMemory: boolean;
    blacklist: string[];
}
export interface RepoState {
    name: string;
    path: string;
    status: RepoStatus;
    ahead: number;
    behind: number;
    fromCache: boolean;
    errorMessage?: string;
}
export interface CacheEntry {
    lastFetch: number;
    status: RepoStatus;
    ahead: number;
    behind: number;
    errorMessage?: string;
}
export type Cache = Record<string, CacheEntry>;
export interface SyncStatusResult {
    repos: RepoState[];
    generatedAt: number;
}
export interface GetSyncStatusOptions {
    now?: () => number;
    fetchTimeoutMs?: number;
    hubClonePath?: string;
}
export declare const DEFAULT_WATCH_CONFIG: WatchConfig;
export declare const CACHE_TTL_MS: number;
export declare const DEFAULT_FETCH_TIMEOUT_MS = 5000;
export declare function loadWatchConfig(pluginDataDir: string): WatchConfig;
export declare function saveWatchConfig(pluginDataDir: string, config: WatchConfig): void;
export declare function readCache(pluginDataDir: string): Cache;
export declare function writeCache(pluginDataDir: string, cache: Cache): void;
export declare function detectRepoStatus(entry: WatchEntry, opts?: {
    fetchTimeoutMs?: number;
}): Promise<Omit<RepoState, "fromCache">>;
export declare function collectWatchedRepos(config: WatchConfig, hubClonePath?: string): WatchEntry[];
export declare function getSyncStatus(pluginDataDir: string, opts?: GetSyncStatusOptions): Promise<SyncStatusResult>;
export declare function formatSyncStatusLine(states: RepoState[]): string;
