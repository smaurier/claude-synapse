import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { cloneOrPullHub } from "../src/config/git.js";

// Real git, real local "remote" (a bare repo) — no mocking of git itself,
// consistent with how this codebase tests real fs/exec behavior elsewhere
// (jonction.test.ts, the RAG integration tests) rather than faking it.

let root: string;
let bareRepoPath: string;
let workDir: string;

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-git-"));
  bareRepoPath = join(root, "bare.git");
  workDir = join(root, "work");

  git(["init", "--bare", bareRepoPath], root);
  git(["init", workDir], root);
  git(["config", "user.email", "test@example.com"], workDir);
  git(["config", "user.name", "Test"], workDir);
  git(["checkout", "-b", "main"], workDir);
  writeFileSync(join(workDir, "a.md"), "premier commit", "utf8");
  git(["add", "."], workDir);
  git(["commit", "-m", "premier commit"], workDir);
  git(["remote", "add", "origin", bareRepoPath], workDir);
  git(["push", "origin", "main"], workDir);
  // A fresh --bare repo's HEAD defaults to whatever init.defaultBranch is
  // locally configured (often "master"), regardless of which branch gets
  // pushed to it — left alone, `git clone` checks out that stale HEAD and
  // silently produces an empty working tree instead of "main"'s content.
  git(["symbolic-ref", "HEAD", "refs/heads/main"], bareRepoPath);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("cloneOrPullHub", () => {
  it("clones when the destination doesn't exist yet", async () => {
    const hubClonePath = join(root, "hub");

    await cloneOrPullHub(bareRepoPath, hubClonePath);

    expect(existsSync(join(hubClonePath, ".git"))).toBe(true);
    expect(readFileSync(join(hubClonePath, "a.md"), "utf8")).toBe("premier commit");
  }, 15_000); // real git subprocess under parallel test load — default 5s timeout is tight

  it("pulls new commits when the destination is already a clone", async () => {
    const hubClonePath = join(root, "hub");
    await cloneOrPullHub(bareRepoPath, hubClonePath);

    // A new commit lands on the "remote" after the first clone.
    writeFileSync(join(workDir, "b.md"), "deuxieme commit", "utf8");
    git(["add", "."], workDir);
    git(["commit", "-m", "deuxieme commit"], workDir);
    git(["push", "origin", "main"], workDir);

    await cloneOrPullHub(bareRepoPath, hubClonePath);

    expect(readFileSync(join(hubClonePath, "b.md"), "utf8")).toBe("deuxieme commit");
  }, 15_000);

  it("throws a diagnostic error rather than a raw git failure when the URL is invalid", async () => {
    const hubClonePath = join(root, "hub-invalide");

    await expect(cloneOrPullHub(join(root, "n-existe-pas.git"), hubClonePath)).rejects.toThrow(/synapse:/);
  }, 15_000);
});
