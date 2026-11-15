import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { commitPaths } from "../src/commands/commitPaths.js";
import { acquireLock } from "../src/lock/lock.js";
import { ensureHubGitignore } from "../src/config/hubGitignore.js";
import { rmTree } from "./helpers/fsTemp.js";

// 15/11/2026 : deux sessions Claude commitent dans le même hub. Un `add -A`
// de l'une emportait la modification de l'autre, dont le `git commit` ne
// trouvait plus rien, et `git log -1` montrait le commit d'un autre.
// commitPaths ne commite QUE les chemins nommés, et dit où est passé un
// chemin qu'un autre a déjà commité.

let root: string;
let bareRepoPath: string;
let hub: string;

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, stdio: "pipe" }).toString();
}

function filesOfHead(): string[] {
  return git(["show", "--name-only", "--format=", "HEAD"], hub).trim().split("\n").filter(Boolean).sort();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-commitpaths-"));
  bareRepoPath = join(root, "bare.git");
  hub = join(root, "hub");

  git(["init", "--bare", bareRepoPath], root);
  const seed = join(root, "seed");
  git(["init", seed], root);
  git(["config", "user.email", "test@example.com"], seed);
  git(["config", "user.name", "Test"], seed);
  git(["checkout", "-b", "main"], seed);
  writeFileSync(join(seed, "a.md"), "contenu initial", "utf8");
  writeFileSync(join(seed, "old.md"), "à supprimer", "utf8");
  ensureHubGitignore(seed);
  git(["add", "."], seed);
  git(["commit", "-m", "seed"], seed);
  git(["remote", "add", "origin", bareRepoPath], seed);
  git(["push", "origin", "main"], seed);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], bareRepoPath);

  git(["clone", bareRepoPath, hub], root);
  git(["config", "user.email", "test@example.com"], hub);
  git(["config", "user.name", "Test"], hub);
});

afterEach(() => {
  rmTree(root);
});

describe("commitPaths", () => {
  it("commits only the named paths and leaves another session's work alone", async () => {
    writeFileSync(join(hub, "mine.md"), "ma modif", "utf8");
    writeFileSync(join(hub, "theirs.md"), "modif de l'autre session", "utf8");
    writeFileSync(join(hub, "a.md"), "l'autre session modifie aussi a.md", "utf8");
    git(["add", "a.md"], hub); // the other session already staged it

    const result = await commitPaths(hub, "machine-a", "ma modif", ["mine.md"], { lockWaitMs: 0 });

    expect(result.status).toBe("committed");
    expect(filesOfHead()).toEqual(["mine.md"]);
    const status = git(["status", "--porcelain"], hub);
    expect(status).toContain("theirs.md");
    expect(status).toMatch(/^M {2}a\.md$/m); // still staged for the other session, untouched
  }, 15_000);

  it("commits additions, modifications and deletions, then pushes", async () => {
    writeFileSync(join(hub, "a.md"), "modifié", "utf8");
    writeFileSync(join(hub, "new.md"), "nouveau", "utf8");
    unlinkSync(join(hub, "old.md"));

    const result = await commitPaths(hub, "machine-a", "trois gestes", ["a.md", "new.md", "old.md"], { lockWaitMs: 0 });

    expect(result.status).toBe("committed");
    expect(filesOfHead()).toEqual(["a.md", "new.md", "old.md"]);
    const verify = join(root, "verify");
    git(["clone", bareRepoPath, verify], root);
    expect(readFileSync(join(verify, "new.md"), "utf8")).toBe("nouveau");
  }, 15_000);

  it("accepts an absolute path inside the hub", async () => {
    writeFileSync(join(hub, "mine.md"), "ma modif", "utf8");
    const result = await commitPaths(hub, "machine-a", "absolu", [join(hub, "mine.md")], { lockWaitMs: 0 });
    expect(result.status).toBe("committed");
    expect(filesOfHead()).toEqual(["mine.md"]);
  }, 15_000);

  it("refuses a path outside the hub", async () => {
    await expect(
      commitPaths(hub, "machine-a", "dehors", [join(root, "seed", "a.md")], { lockWaitMs: 0 }),
    ).rejects.toThrow(/hors du hub/);
  }, 15_000);

  it("says WHERE a path went when another session already committed it", async () => {
    writeFileSync(join(hub, "mine.md"), "ma modif", "utf8");
    git(["add", "-A"], hub); // the other session's sweep
    git(["commit", "-m", "nayeli: commit de l'autre session"], hub);
    const theirHash = git(["rev-parse", "--short", "HEAD"], hub).trim();

    const result = await commitPaths(hub, "machine-a", "ma modif", ["mine.md"], { lockWaitMs: 0 });

    expect(result.status).toBe("nothing-to-commit");
    expect(result.elsewhere).toEqual([{ path: "mine.md", commit: `${theirHash} nayeli: commit de l'autre session` }]);
  }, 15_000);

  it("commits what's left and reports what another session already took", async () => {
    writeFileSync(join(hub, "first.md"), "un", "utf8");
    git(["add", "first.md"], hub);
    git(["commit", "-m", "autre session"], hub);
    writeFileSync(join(hub, "second.md"), "deux", "utf8");

    const result = await commitPaths(hub, "machine-a", "le reste", ["first.md", "second.md"], { lockWaitMs: 0 });

    expect(result.status).toBe("committed");
    expect(result.committed).toEqual(["second.md"]);
    expect(result.elsewhere?.map((e) => e.path)).toEqual(["first.md"]);
  }, 15_000);

  it("refuses to commit a file containing a secret", async () => {
    writeFileSync(join(hub, "oops.md"), "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE", "utf8");
    const result = await commitPaths(hub, "machine-a", "oups", ["oops.md"], { lockWaitMs: 0 });
    expect(result.status).toBe("aborted-secrets-found");
    expect(git(["rev-list", "--count", "HEAD"], hub).trim()).toBe("1");
  }, 15_000);

  it("refuses while another live process of the same machine holds the lock", async () => {
    writeFileSync(join(hub, "mine.md"), "ma modif", "utf8");
    acquireLock(hub, "machine-a", 10, new Date(), process.ppid);
    const result = await commitPaths(hub, "machine-a", "ma modif", ["mine.md"], { lockWaitMs: 0 });
    expect(result.status).toBe("aborted-lock-held");
    expect(git(["rev-list", "--count", "HEAD"], hub).trim()).toBe("1");
  }, 15_000);

  it("keeps the local commit and says so when the push is refused", async () => {
    const other = join(root, "other");
    git(["clone", bareRepoPath, other], root);
    git(["config", "user.email", "test@example.com"], other);
    git(["config", "user.name", "Test"], other);
    writeFileSync(join(other, "a.md"), "conflit distant", "utf8");
    git(["commit", "-am", "distant"], other);
    git(["push", "origin", "main"], other);
    writeFileSync(join(hub, "a.md"), "conflit local", "utf8");

    const result = await commitPaths(hub, "machine-a", "local", ["a.md"], { lockWaitMs: 0 });

    expect(result.status).toBe("committed-not-pushed");
    expect(result.commitHash).toBeDefined();
    expect(git(["rev-list", "--count", "HEAD"], hub).trim()).toBe("2");
  }, 15_000);
});
