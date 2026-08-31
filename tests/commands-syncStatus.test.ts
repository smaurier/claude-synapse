import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  loadWatchConfig,
  saveWatchConfig,
  readCache,
  writeCache,
  detectRepoStatus,
  getSyncStatus,
  formatSyncStatusLine,
  DEFAULT_WATCH_CONFIG,
  CACHE_TTL_MS,
  type WatchConfig,
  type RepoState,
} from "../src/commands/syncStatus.js";

let root: string;
let pluginDataDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-sync-status-"));
  pluginDataDir = join(root, "plugin-data");
  mkdirSync(pluginDataDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function git(path: string, args: string[]): void {
  execFileSync("git", args, { cwd: path, stdio: "pipe" });
}

function initGitRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  git(path, ["init", "-q", "-b", "main"]);
  git(path, ["config", "user.email", "test@example.com"]);
  git(path, ["config", "user.name", "Test"]);
  git(path, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(path, "seed.txt"), "seed", "utf8");
  git(path, ["add", "."]);
  git(path, ["commit", "-q", "-m", "seed"]);
}

function makeBareRemote(path: string): void {
  mkdirSync(path, { recursive: true });
  git(path, ["init", "-q", "--bare", "-b", "main"]);
}

describe("watch config", () => {
  it("returns defaults when the config file is absent", () => {
    const config = loadWatchConfig(pluginDataDir);
    expect(config).toEqual(DEFAULT_WATCH_CONFIG);
  });

  it("round-trips through save and load", () => {
    const custom: WatchConfig = {
      explicit: [{ name: "myrepo", path: "/tmp/myrepo" }],
      scanPaths: [],
      fromMemory: false,
      blacklist: ["dead-repo"],
    };
    saveWatchConfig(pluginDataDir, custom);
    expect(loadWatchConfig(pluginDataDir)).toEqual(custom);
  });

  it("ignores unknown fields defensively and fills missing ones", () => {
    const raw = { explicit: [{ name: "x", path: "/x" }], mystery: 42 };
    writeFileSync(
      join(pluginDataDir, "sync-watch.json"),
      JSON.stringify(raw),
      "utf8",
    );
    const config = loadWatchConfig(pluginDataDir);
    expect(config.explicit).toEqual([{ name: "x", path: "/x" }]);
    expect(config.scanPaths).toEqual([]);
    expect(config.blacklist).toEqual([]);
    expect(config.fromMemory).toBe(false);
  });
});

describe("cache", () => {
  it("returns empty object when the cache file is absent", () => {
    expect(readCache(pluginDataDir)).toEqual({});
  });

  it("round-trips a cache entry", () => {
    const entry = {
      "repo-a": { lastFetch: 12345, status: "ok" as const, ahead: 0, behind: 0 },
    };
    writeCache(pluginDataDir, entry);
    expect(readCache(pluginDataDir)).toEqual(entry);
  });
});

describe("detectRepoStatus", () => {
  it("reports 'ok' for a repo aligned with its remote", async () => {
    const remote = join(root, "remote.git");
    const local = join(root, "local");
    makeBareRemote(remote);
    initGitRepo(local);
    git(local, ["remote", "add", "origin", remote]);
    git(local, ["push", "-q", "-u", "origin", "main"]);

    const state = await detectRepoStatus({ name: "local", path: local });
    expect(state.status).toBe("ok");
    expect(state.ahead).toBe(0);
    expect(state.behind).toBe(0);
  });

  it("reports 'behind' when the remote has commits the local does not", async () => {
    const remote = join(root, "remote.git");
    const local = join(root, "local");
    const other = join(root, "other");
    makeBareRemote(remote);
    initGitRepo(local);
    git(local, ["remote", "add", "origin", remote]);
    git(local, ["push", "-q", "-u", "origin", "main"]);

    execFileSync("git", ["clone", "-q", remote, other], { stdio: "pipe" });
    git(other, ["config", "user.email", "o@x.io"]);
    git(other, ["config", "user.name", "o"]);
    writeFileSync(join(other, "new.txt"), "new", "utf8");
    git(other, ["add", "."]);
    git(other, ["commit", "-q", "-m", "add"]);
    git(other, ["push", "-q"]);

    const state = await detectRepoStatus({ name: "local", path: local });
    expect(state.status).toBe("behind");
    expect(state.behind).toBe(1);
    expect(state.ahead).toBe(0);
  });

  it("reports 'ahead' when the local has commits not yet pushed", async () => {
    const remote = join(root, "remote.git");
    const local = join(root, "local");
    makeBareRemote(remote);
    initGitRepo(local);
    git(local, ["remote", "add", "origin", remote]);
    git(local, ["push", "-q", "-u", "origin", "main"]);
    writeFileSync(join(local, "b.txt"), "b", "utf8");
    git(local, ["add", "."]);
    git(local, ["commit", "-q", "-m", "b"]);

    const state = await detectRepoStatus({ name: "local", path: local });
    expect(state.status).toBe("ahead");
    expect(state.ahead).toBe(1);
    expect(state.behind).toBe(0);
  });

  it("reports 'diverged' when local and remote have unrelated commits", async () => {
    const remote = join(root, "remote.git");
    const local = join(root, "local");
    const other = join(root, "other");
    makeBareRemote(remote);
    initGitRepo(local);
    git(local, ["remote", "add", "origin", remote]);
    git(local, ["push", "-q", "-u", "origin", "main"]);

    execFileSync("git", ["clone", "-q", remote, other], { stdio: "pipe" });
    git(other, ["config", "user.email", "o@x.io"]);
    git(other, ["config", "user.name", "o"]);
    writeFileSync(join(other, "other.txt"), "other", "utf8");
    git(other, ["add", "."]);
    git(other, ["commit", "-q", "-m", "other"]);
    git(other, ["push", "-q"]);

    writeFileSync(join(local, "local.txt"), "local", "utf8");
    git(local, ["add", "."]);
    git(local, ["commit", "-q", "-m", "local"]);

    const state = await detectRepoStatus({ name: "local", path: local });
    expect(state.status).toBe("diverged");
  });

  it("reports 'error' when the path is not a git repo", async () => {
    const state = await detectRepoStatus({ name: "nope", path: join(root, "does-not-exist") });
    expect(state.status).toBe("error");
    expect(state.errorMessage).toBeDefined();
  });

  it("reports 'error' when there is no remote configured", async () => {
    const local = join(root, "local");
    initGitRepo(local);
    const state = await detectRepoStatus({ name: "local", path: local });
    expect(state.status).toBe("error");
  });
});

describe("getSyncStatus with cache", () => {
  it("uses cache when entry is fresh (younger than TTL)", async () => {
    const local = join(root, "local");
    initGitRepo(local);
    saveWatchConfig(pluginDataDir, {
      explicit: [{ name: "cached", path: local }],
      scanPaths: [],
      fromMemory: false,
      blacklist: [],
    });
    const fresh = Date.now() - 60_000;
    writeCache(pluginDataDir, {
      cached: { lastFetch: fresh, status: "ok", ahead: 0, behind: 0 },
    });

    const result = await getSyncStatus(pluginDataDir, { now: () => fresh + 60_000 });
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].status).toBe("ok");
    expect(result.repos[0].fromCache).toBe(true);
  });

  it("re-fetches when cache is stale (older than TTL)", async () => {
    const remote = join(root, "remote.git");
    const local = join(root, "local");
    makeBareRemote(remote);
    initGitRepo(local);
    git(local, ["remote", "add", "origin", remote]);
    git(local, ["push", "-q", "-u", "origin", "main"]);

    saveWatchConfig(pluginDataDir, {
      explicit: [{ name: "stale", path: local }],
      scanPaths: [],
      fromMemory: false,
      blacklist: [],
    });
    const veryOld = Date.now() - CACHE_TTL_MS - 60_000;
    writeCache(pluginDataDir, {
      stale: { lastFetch: veryOld, status: "behind", ahead: 0, behind: 99 },
    });

    const result = await getSyncStatus(pluginDataDir);
    expect(result.repos[0].status).toBe("ok");
    expect(result.repos[0].fromCache).toBe(false);
  });

  it("filters out repos in the blacklist", async () => {
    const local = join(root, "local");
    initGitRepo(local);
    saveWatchConfig(pluginDataDir, {
      explicit: [{ name: "excluded", path: local }],
      scanPaths: [],
      fromMemory: false,
      blacklist: ["excluded"],
    });

    const result = await getSyncStatus(pluginDataDir);
    expect(result.repos).toHaveLength(0);
  });
});

describe("formatSyncStatusLine", () => {
  const base: Omit<RepoState, "status" | "ahead" | "behind"> = {
    name: "x",
    path: "/x",
    fromCache: false,
  };

  it("shows a single 'all ok' summary when everything is aligned", () => {
    const line = formatSyncStatusLine([
      { ...base, name: "a", status: "ok", ahead: 0, behind: 0 },
      { ...base, name: "b", status: "ok", ahead: 0, behind: 0 },
    ]);
    expect(line).toContain("SYNC STATUS");
    expect(line).toContain("2 ok");
  });

  it("names repos that are behind or diverged", () => {
    const line = formatSyncStatusLine([
      { ...base, name: "ok-repo", status: "ok", ahead: 0, behind: 0 },
      { ...base, name: "late", status: "behind", ahead: 0, behind: 3 },
      { ...base, name: "unpushed", status: "ahead", ahead: 1, behind: 0 },
      { ...base, name: "clash", status: "diverged", ahead: 2, behind: 2 },
      { ...base, name: "boom", status: "error", ahead: 0, behind: 0, errorMessage: "no remote" },
    ]);
    expect(line).toContain("late");
    expect(line).toContain("3");
    expect(line).toContain("unpushed");
    expect(line).toContain("clash");
    expect(line).toContain("divergence");
    expect(line).toContain("boom");
    expect(line).toContain("1 ok");
  });

  it("handles an empty repo list gracefully", () => {
    const line = formatSyncStatusLine([]);
    expect(line).toContain("SYNC STATUS");
    expect(line).toContain("aucun");
  });
});

describe("file layout", () => {
  it("writes config to sync-watch.json and cache to sync-status-cache.json", () => {
    saveWatchConfig(pluginDataDir, DEFAULT_WATCH_CONFIG);
    writeCache(pluginDataDir, {});
    expect(existsSync(join(pluginDataDir, "sync-watch.json"))).toBe(true);
    expect(existsSync(join(pluginDataDir, "sync-status-cache.json"))).toBe(true);
    expect(() =>
      JSON.parse(readFileSync(join(pluginDataDir, "sync-watch.json"), "utf8")),
    ).not.toThrow();
  });
});
