import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { cloneOrPullHub, unlockGitCryptIfPresent } from "../src/config/git.js";

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

  it("refuses to pull an existing directory whose origin remote points at a DIFFERENT repo", async () => {
    // The "adopt an existing directory as hub" path makes hubClonePath a
    // user-chosen, pre-existing location for the first time — previously it
    // was always either empty or a clone this same code had made. Pulling
    // blindly into whatever already has a .git there would silently mix an
    // unrelated repo's history with the memory hub's if the caller passed
    // the wrong path. This must be caught BEFORE any pull is attempted.
    const otherBareRepoPath = join(root, "other-bare.git");
    git(["init", "--bare", otherBareRepoPath], root);
    const otherWorkDir = join(root, "other-work");
    git(["init", otherWorkDir], root);
    git(["config", "user.email", "test@example.com"], otherWorkDir);
    git(["config", "user.name", "Test"], otherWorkDir);
    git(["checkout", "-b", "main"], otherWorkDir);
    writeFileSync(join(otherWorkDir, "unrelated.md"), "un autre projet", "utf8");
    git(["add", "."], otherWorkDir);
    git(["commit", "-m", "premier commit"], otherWorkDir);
    git(["remote", "add", "origin", otherBareRepoPath], otherWorkDir);
    git(["push", "origin", "main"], otherWorkDir);
    git(["symbolic-ref", "HEAD", "refs/heads/main"], otherBareRepoPath);

    const hubClonePath = join(root, "hub-mal-cible");
    git(["clone", otherBareRepoPath, hubClonePath], root);

    await expect(cloneOrPullHub(bareRepoPath, hubClonePath)).rejects.toThrow(/synapse:/);
    // Refused before touching anything — the unrelated repo's content is untouched.
    expect(existsSync(join(hubClonePath, "unrelated.md"))).toBe(true);
    expect(existsSync(join(hubClonePath, "a.md"))).toBe(false);
  }, 15_000);
});

// Real gpg + real git-crypt, isolated GPG keyring per test (never touches the
// machine's real keyring) — same "no mocking" bias as the rest of this file.
// GNUPGHOME needs a unix-style path (`/c/Users/...`) even though this test
// runs under plain Node on Windows: the git-crypt/gpg binaries on this
// platform are MSYS-built and misparse a native `C:\...` GNUPGHOME when
// there's no MSYS shell in the process chain to translate it for them —
// purely a path-format quirk of these binaries, unrelated to the feature
// under test. Production code never sets GNUPGHOME at all, so real usage
// (default keyring) is unaffected.
function toGpgHomePath(p: string): string {
  return "/" + p[0]!.toLowerCase() + p.slice(2).replaceAll("\\", "/");
}

describe("unlockGitCryptIfPresent", () => {
  let gcRoot: string;
  let gnupgEnvBackup: string | undefined;

  beforeEach(() => {
    gcRoot = mkdtempSync(join(tmpdir(), "synapse-gitcrypt-"));
    gnupgEnvBackup = process.env.GNUPGHOME;
    const gnupgHome = join(gcRoot, "gnupg");
    mkdirSync(gnupgHome, { recursive: true });
    process.env.GNUPGHOME = toGpgHomePath(gnupgHome);
    execFileSync(
      "gpg",
      [
        "--batch",
        "--gen-key",
        (() => {
          const p = join(gcRoot, "keyparams");
          writeFileSync(
            p,
            "%no-protection\nKey-Type: RSA\nKey-Length: 2048\nName-Real: Test Synapse\n" +
              "Name-Email: test@synapse.local\nExpire-Date: 0\n%commit\n",
          );
          return p;
        })(),
      ],
      { stdio: "pipe" },
    );
  });

  afterEach(() => {
    if (gnupgEnvBackup === undefined) delete process.env.GNUPGHOME;
    else process.env.GNUPGHOME = gnupgEnvBackup;
    rmSync(gcRoot, { recursive: true, force: true });
  });

  function seedGitCryptRepo(): string {
    const seed = join(gcRoot, "seed");
    mkdirSync(seed, { recursive: true });
    git(["init", "-q", "-b", "main"], seed);
    git(["config", "user.email", "test@example.com"], seed);
    git(["config", "user.name", "Test"], seed);
    execFileSync("git-crypt", ["init"], { cwd: seed, stdio: "pipe" });
    writeFileSync(join(seed, ".gitattributes"), "secret.md filter=git-crypt diff=git-crypt\n");
    writeFileSync(join(seed, "secret.md"), "contenu secret\n");
    execFileSync("git-crypt", ["add-gpg-user", "--trusted", "test@synapse.local"], { cwd: seed, stdio: "pipe" });
    git(["add", "-A"], seed);
    git(["commit", "-q", "-m", "seed"], seed);
    return seed;
  }

  it("does nothing on a plain (non-git-crypt) directory — no throw, no-op", async () => {
    const plain = join(gcRoot, "plain");
    mkdirSync(plain, { recursive: true });
    await expect(unlockGitCryptIfPresent(plain)).resolves.toBeUndefined();
  });

  it("decrypts a git-crypt clone when the machine already has the collaborator key", async () => {
    const seed = seedGitCryptRepo();
    const clone = join(gcRoot, "clone");
    git(["clone", "-q", seed, clone], gcRoot);
    expect(readFileSync(join(clone, "secret.md"), "latin1").charCodeAt(0)).toBe(0); // still encrypted

    await unlockGitCryptIfPresent(clone);

    expect(readFileSync(join(clone, "secret.md"), "utf8")).toBe("contenu secret\n");
  }, 15_000);

  it("is safe to call twice on an already-unlocked clone", async () => {
    const seed = seedGitCryptRepo();
    const clone = join(gcRoot, "clone2");
    git(["clone", "-q", seed, clone], gcRoot);

    await unlockGitCryptIfPresent(clone);
    await expect(unlockGitCryptIfPresent(clone)).resolves.toBeUndefined();
  }, 15_000);

  it("cloneOrPullHub itself ends with a readable (auto-unlocked) working tree", async () => {
    const seed = seedGitCryptRepo();
    const clone = join(gcRoot, "clone-via-cloneOrPullHub");

    await cloneOrPullHub(seed, clone);

    expect(readFileSync(join(clone, "secret.md"), "utf8")).toBe("contenu secret\n");
  }, 15_000);
});
