import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { syncBrain } from "../src/commands/syncBrain.js";
import { acquireLock } from "../src/lock/lock.js";
import { ensureHubGitignore } from "../src/config/hubGitignore.js";

let root: string;
let bareRepoPath: string;
let hubClonePath: string;

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, stdio: "pipe" }).toString();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-syncbrain-"));
  bareRepoPath = join(root, "bare.git");
  hubClonePath = join(root, "hub");

  git(["init", "--bare", bareRepoPath], root);
  const seed = join(root, "seed");
  git(["init", seed], root);
  git(["config", "user.email", "test@example.com"], seed);
  git(["config", "user.name", "Test"], seed);
  git(["checkout", "-b", "main"], seed);
  writeFileSync(join(seed, "a.md"), "contenu initial", "utf8");
  // Mirrors what a real hub looks like after /synapse-init (bootstrap.ts
  // calls ensureHubGitignore, then a first sync commits it) — established
  // here as part of the seed history so it's already tracked when
  // hubClonePath clones, not an extra uncommitted file each test has to
  // account for.
  ensureHubGitignore(seed);
  git(["add", "."], seed);
  git(["commit", "-m", "seed"], seed);
  git(["remote", "add", "origin", bareRepoPath], seed);
  git(["push", "origin", "main"], seed);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], bareRepoPath);

  git(["clone", bareRepoPath, hubClonePath], root);
  git(["config", "user.email", "test@example.com"], hubClonePath);
  git(["config", "user.name", "Test"], hubClonePath);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("syncBrain", () => {
  it("is a no-op when there's nothing to sync", async () => {
    const result = await syncBrain(hubClonePath, "machine-a");
    expect(result).toEqual({ status: "nothing-to-sync" });
  }, 15_000);

  it("commits, journals, and pushes ordinary changes", async () => {
    writeFileSync(join(hubClonePath, "b.md"), "nouveau fait", "utf8");

    const result = await syncBrain(hubClonePath, "machine-a");

    expect(result.status).toBe("synced");
    expect(result.filesChanged).toBe(1);
    expect(existsSync(join(hubClonePath, ".synapse", "sync-journal.jsonl"))).toBe(true);
    const journalEntry = JSON.parse(readFileSync(join(hubClonePath, ".synapse", "sync-journal.jsonl"), "utf8").trim());
    expect(journalEntry.machineId).toBe("machine-a");

    // Verify it actually reached the remote, not just committed locally.
    const otherClone = join(root, "verify-clone");
    git(["clone", bareRepoPath, otherClone], root);
    expect(readFileSync(join(otherClone, "b.md"), "utf8")).toBe("nouveau fait");
  }, 15_000);

  it("refuses to commit or push when a changed file contains a secret", async () => {
    writeFileSync(join(hubClonePath, "oops.md"), "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE", "utf8");

    const result = await syncBrain(hubClonePath, "machine-a");

    expect(result.status).toBe("aborted-secrets-found");
    expect(result.secretsFound?.["oops.md"]).toBeDefined();
    // Nothing committed — the file is still just an uncommitted change.
    expect(git(["status", "--porcelain"], hubClonePath).trim()).not.toBe("");
    expect(git(["rev-list", "--count", "HEAD"], hubClonePath).trim()).toBe("1"); // still just "seed"
  }, 15_000);

  it("refuses when another machine already holds the lock", async () => {
    writeFileSync(join(hubClonePath, "b.md"), "nouveau fait", "utf8");
    acquireLock(hubClonePath, "autre-machine", 10);

    const result = await syncBrain(hubClonePath, "machine-a");

    expect(result.status).toBe("aborted-lock-held");
  }, 15_000);

  it("commits locally but reports aborted-push-conflict on real divergence, without force-pushing", async () => {
    // Another machine pushes first.
    const otherClone = join(root, "other-machine");
    git(["clone", bareRepoPath, otherClone], root);
    git(["config", "user.email", "test@example.com"], otherClone);
    git(["config", "user.name", "Test"], otherClone);
    writeFileSync(join(otherClone, "from-other-machine.md"), "fait d'une autre machine", "utf8");
    git(["add", "."], otherClone);
    git(["commit", "-m", "depuis une autre machine"], otherClone);
    git(["push", "origin", "main"], otherClone);

    // Our clone is now behind — it makes its own local change without pulling first.
    writeFileSync(join(hubClonePath, "b.md"), "nouveau fait local", "utf8");

    const result = await syncBrain(hubClonePath, "machine-a");

    expect(result.status).toBe("aborted-push-conflict");
    expect(result.commitHash).toBeDefined();
    // The local commit still exists — nothing was lost.
    expect(git(["rev-list", "--count", "HEAD"], hubClonePath).trim()).toBe("2");
  }, 15_000);
});
