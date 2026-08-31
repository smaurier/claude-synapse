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
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
export const DEFAULT_WATCH_CONFIG = {
    explicit: [],
    scanPaths: [],
    fromMemory: false,
    blacklist: [],
};
export const CACHE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_FETCH_TIMEOUT_MS = 5000;
const CONFIG_FILENAME = "sync-watch.json";
const CACHE_FILENAME = "sync-status-cache.json";
// ---------- config ----------
export function loadWatchConfig(pluginDataDir) {
    const path = join(pluginDataDir, CONFIG_FILENAME);
    if (!existsSync(path)) {
        return { ...DEFAULT_WATCH_CONFIG };
    }
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return {
        explicit: Array.isArray(raw.explicit)
            ? raw.explicit.filter((e) => typeof e === "object" &&
                e !== null &&
                typeof e.name === "string" &&
                typeof e.path === "string")
            : [],
        scanPaths: Array.isArray(raw.scanPaths)
            ? raw.scanPaths.filter((s) => typeof s === "string")
            : [],
        fromMemory: typeof raw.fromMemory === "boolean" ? raw.fromMemory : false,
        blacklist: Array.isArray(raw.blacklist)
            ? raw.blacklist.filter((s) => typeof s === "string")
            : [],
    };
}
export function saveWatchConfig(pluginDataDir, config) {
    const path = join(pluginDataDir, CONFIG_FILENAME);
    writeFileSync(path, JSON.stringify(config, null, 2), "utf8");
}
// ---------- cache ----------
export function readCache(pluginDataDir) {
    const path = join(pluginDataDir, CACHE_FILENAME);
    if (!existsSync(path)) {
        return {};
    }
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return {};
    }
}
export function writeCache(pluginDataDir, cache) {
    const path = join(pluginDataDir, CACHE_FILENAME);
    writeFileSync(path, JSON.stringify(cache, null, 2), "utf8");
}
// ---------- git probing ----------
function runGit(cwd, args, timeoutMs) {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
    }).trim();
}
export async function detectRepoStatus(entry, opts = {}) {
    const timeoutMs = opts.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    if (!existsSync(entry.path)) {
        return {
            name: entry.name,
            path: entry.path,
            status: "error",
            ahead: 0,
            behind: 0,
            errorMessage: "path does not exist",
        };
    }
    try {
        runGit(entry.path, ["rev-parse", "--git-dir"], 2000);
    }
    catch {
        return {
            name: entry.name,
            path: entry.path,
            status: "error",
            ahead: 0,
            behind: 0,
            errorMessage: "not a git repository",
        };
    }
    let upstream;
    try {
        upstream = runGit(entry.path, ["rev-parse", "--abbrev-ref", "@{u}"], 2000);
    }
    catch {
        return {
            name: entry.name,
            path: entry.path,
            status: "error",
            ahead: 0,
            behind: 0,
            errorMessage: "no upstream tracking branch",
        };
    }
    // Best-effort fetch. Silent failures don't nuke the whole report; we compare
    // against whatever remote-tracking branch data is currently available.
    const remote = upstream.split("/")[0] ?? "origin";
    try {
        runGit(entry.path, ["fetch", "--quiet", remote], timeoutMs);
    }
    catch {
        // continue with stale remote-tracking data
    }
    let leftRight;
    try {
        leftRight = runGit(entry.path, ["rev-list", "--left-right", "--count", "HEAD...@{u}"], 2000);
    }
    catch (err) {
        return {
            name: entry.name,
            path: entry.path,
            status: "error",
            ahead: 0,
            behind: 0,
            errorMessage: err instanceof Error ? err.message : String(err),
        };
    }
    const parts = leftRight.split(/\s+/);
    const ahead = Number.parseInt(parts[0] ?? "0", 10) || 0;
    const behind = Number.parseInt(parts[1] ?? "0", 10) || 0;
    let status;
    if (ahead === 0 && behind === 0)
        status = "ok";
    else if (ahead > 0 && behind === 0)
        status = "ahead";
    else if (ahead === 0 && behind > 0)
        status = "behind";
    else
        status = "diverged";
    return {
        name: entry.name,
        path: entry.path,
        status,
        ahead,
        behind,
    };
}
// ---------- repo discovery (harnass) ----------
function scanForGitRepos(root) {
    if (!existsSync(root))
        return [];
    const entries = [];
    for (const child of readdirSync(root, { withFileTypes: true })) {
        if (!child.isDirectory())
            continue;
        const full = join(root, child.name);
        if (existsSync(join(full, ".git"))) {
            entries.push({ name: child.name, path: full });
        }
    }
    return entries;
}
function extractRepoUrlsFromMemory(hubClonePath) {
    // fromMemory is deferred to a follow-up: parsing MEMORY.md is cheap, but
    // mapping "github.com/user/repo" URLs to actual local clones needs a live
    // index we don't have yet. Returning an empty list keeps the harness API
    // stable without inventing bogus paths.
    if (!hubClonePath || !existsSync(hubClonePath))
        return [];
    return [];
}
export function collectWatchedRepos(config, hubClonePath) {
    const collected = new Map();
    for (const entry of config.explicit) {
        collected.set(resolve(entry.path), entry);
    }
    for (const scanRoot of config.scanPaths) {
        for (const found of scanForGitRepos(scanRoot)) {
            const key = resolve(found.path);
            if (!collected.has(key))
                collected.set(key, found);
        }
    }
    if (config.fromMemory) {
        for (const found of extractRepoUrlsFromMemory(hubClonePath)) {
            const key = resolve(found.path);
            if (!collected.has(key))
                collected.set(key, found);
        }
    }
    const blacklist = new Set(config.blacklist);
    return [...collected.values()].filter((e) => !blacklist.has(e.name));
}
// ---------- orchestration ----------
export async function getSyncStatus(pluginDataDir, opts = {}) {
    const now = opts.now ?? (() => Date.now());
    const config = loadWatchConfig(pluginDataDir);
    const cache = readCache(pluginDataDir);
    const currentTime = now();
    const watched = collectWatchedRepos(config, opts.hubClonePath);
    const detectOpts = opts.fetchTimeoutMs !== undefined ? { fetchTimeoutMs: opts.fetchTimeoutMs } : {};
    const states = await Promise.all(watched.map(async (entry) => {
        const cached = cache[entry.name];
        const fresh = cached && currentTime - cached.lastFetch < CACHE_TTL_MS;
        if (fresh) {
            const base = {
                name: entry.name,
                path: entry.path,
                status: cached.status,
                ahead: cached.ahead,
                behind: cached.behind,
                fromCache: true,
            };
            return cached.errorMessage !== undefined
                ? { ...base, errorMessage: cached.errorMessage }
                : base;
        }
        const detected = await detectRepoStatus(entry, detectOpts);
        const cacheEntry = {
            lastFetch: currentTime,
            status: detected.status,
            ahead: detected.ahead,
            behind: detected.behind,
            ...(detected.errorMessage !== undefined ? { errorMessage: detected.errorMessage } : {}),
        };
        cache[entry.name] = cacheEntry;
        const base = {
            name: detected.name,
            path: detected.path,
            status: detected.status,
            ahead: detected.ahead,
            behind: detected.behind,
            fromCache: false,
        };
        return detected.errorMessage !== undefined
            ? { ...base, errorMessage: detected.errorMessage }
            : base;
    }));
    writeCache(pluginDataDir, cache);
    return { repos: states, generatedAt: currentTime };
}
// ---------- formatting ----------
export function formatSyncStatusLine(states) {
    if (states.length === 0) {
        return "SYNC STATUS: aucun dépôt surveillé (voir sync-watch.json)";
    }
    const okCount = states.filter((s) => s.status === "ok").length;
    const problems = states.filter((s) => s.status !== "ok");
    const parts = [`${okCount} ok`];
    for (const state of problems) {
        if (state.status === "behind") {
            parts.push(`${state.name} ⬇${state.behind}`);
        }
        else if (state.status === "ahead") {
            parts.push(`${state.name} ⬆${state.ahead}`);
        }
        else if (state.status === "diverged") {
            parts.push(`${state.name} divergence (${state.ahead}↑/${state.behind}↓)`);
        }
        else {
            parts.push(`${state.name} ?`);
        }
    }
    return `SYNC STATUS: ${parts.join(" · ")}`;
}
//# sourceMappingURL=syncStatus.js.map