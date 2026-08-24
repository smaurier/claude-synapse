import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runSynapseInit } from "../src/commands/synapseInit.js";
import { createLink } from "../src/jonction/jonction.js";

// Real git (local bare repo, same technique as git.test.ts) + real fs links —
// end-to-end proof of the whole /synapse-init flow, no mocking.

let root: string;
let bareRepoPath: string;
let pluginDataDir: string;
let linkPath: string;

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-init-"));
  bareRepoPath = join(root, "bare.git");
  pluginDataDir = join(root, "plugin-data");
  linkPath = join(root, "project", "memory");
  mkdirSync(join(root, "project"), { recursive: true });

  const seedWorkDir = join(root, "seed");
  git(["init", "--bare", bareRepoPath], root);
  git(["init", seedWorkDir], root);
  git(["config", "user.email", "test@example.com"], seedWorkDir);
  git(["config", "user.name", "Test"], seedWorkDir);
  git(["checkout", "-b", "main"], seedWorkDir);
  writeFileSync(join(seedWorkDir, "existing-memory.md"), "fait existant", "utf8");
  git(["add", "."], seedWorkDir);
  git(["commit", "-m", "seed"], seedWorkDir);
  git(["remote", "add", "origin", bareRepoPath], seedWorkDir);
  git(["push", "origin", "main"], seedWorkDir);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], bareRepoPath);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runSynapseInit", () => {
  it("clones the hub, links it, and writes local + shared config on first run", async () => {
    const result = await runSynapseInit({ pluginDataDir, hubUrl: bareRepoPath, linkPath });

    expect(result.link.action).toBe("created");
    expect(existsSync(join(pluginDataDir, "local-config.json"))).toBe(true);
    expect(existsSync(join(result.hubClonePath, ".synapse", "config.json"))).toBe(true);
    expect(readFileSync(join(linkPath, "existing-memory.md"), "utf8")).toBe("fait existant");
  }, 15_000);

  it("is safe to run twice — second run is a no-op on the link, pulls without error", async () => {
    await runSynapseInit({ pluginDataDir, hubUrl: bareRepoPath, linkPath });

    const second = await runSynapseInit({ pluginDataDir, hubUrl: bareRepoPath, linkPath });

    expect(second.link.action).toBe("already-ok");
  }, 15_000);

  it("recreates a link pointing at the wrong place, without asking", async () => {
    const decoyTarget = join(root, "decoy");
    mkdirSync(decoyTarget, { recursive: true });
    createLink(decoyTarget, linkPath);

    const result = await runSynapseInit({ pluginDataDir, hubUrl: bareRepoPath, linkPath });

    expect(result.link.action).toBe("recreated");
    expect(readFileSync(join(linkPath, "existing-memory.md"), "utf8")).toBe("fait existant");
  }, 15_000);

  it("backs up real pre-existing local content before linking, never loses it silently", async () => {
    mkdirSync(linkPath, { recursive: true });
    writeFileSync(join(linkPath, "local-only.md"), "note locale jamais poussee", "utf8");

    const result = await runSynapseInit({ pluginDataDir, hubUrl: bareRepoPath, linkPath });

    expect(result.link.action).toBe("recreated-after-backup");
    expect(existsSync(join(result.link.backupPath!, "local-only.md"))).toBe(true);
    // The link now shows the hub's content, not the backed-up local one.
    expect(existsSync(join(linkPath, "existing-memory.md"))).toBe(true);
  }, 15_000);
});

describe("runSynapseInit — hub visibility gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses outright when the hub is confirmed public on GitHub, without touching the filesystem", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 200, json: async () => ({ private: false }) }) as Response),
    );

    await expect(
      runSynapseInit({ pluginDataDir, hubUrl: "git@github.com:example-user/public-hub.git", linkPath }),
    ).rejects.toThrow(/PUBLIC/);

    expect(existsSync(join(pluginDataDir, "local-config.json"))).toBe(false);
  });

  it("surfaces a visibility warning (not a refusal) when the host can't be checked, e.g. a local bare repo", async () => {
    const result = await runSynapseInit({ pluginDataDir, hubUrl: bareRepoPath, linkPath });
    expect(result.visibilityWarning).toMatch(/non vérifiable/);
  }, 15_000);
});

// Ajouté 24/08 : couvre le cas réel qui a bloqué la reprise du 24/08 (voir
// memory/project_claude_brain_opensource.md, item 14) — un dossier existant,
// déjà cloné et déjà utilisé en place (pas un nouveau clone dans
// <pluginDataDir>/hub), adopté comme hub sans jamais être dupliqué ni
// déplacé.
describe("runSynapseInit — adopting an existing directory as hub", () => {
  it("adopts an existing clone in place (hubClonePath override = linkPath): pulls, never clones, never backs up its own content", async () => {
    const existingDir = join(root, "deja-la", "memory");
    mkdirSync(join(root, "deja-la"), { recursive: true });
    git(["clone", bareRepoPath, existingDir], root);

    const result = await runSynapseInit({
      pluginDataDir,
      hubUrl: bareRepoPath,
      linkPath: existingDir,
      hubClonePath: existingDir,
    });

    expect(result.hubClonePath).toBe(existingDir);
    expect(result.link.action).toBe("already-ok"); // self-hosting: nothing to link
    expect(readFileSync(join(existingDir, "existing-memory.md"), "utf8")).toBe("fait existant");
    // No backup sibling was ever created next to the adopted directory.
    expect(existsSync(join(root, "deja-la", "memory.bak"))).toBe(false);
  }, 15_000);

  it("persists a corpusRoot override into the adopted hub's shared config", async () => {
    const existingDir = join(root, "deja-la", "memory");
    mkdirSync(join(root, "deja-la"), { recursive: true });
    git(["clone", bareRepoPath, existingDir], root);

    await runSynapseInit({
      pluginDataDir,
      hubUrl: bareRepoPath,
      linkPath: existingDir,
      hubClonePath: existingDir,
      corpusRoot: "memory",
    });

    const sharedConfig = JSON.parse(readFileSync(join(existingDir, ".synapse", "config.json"), "utf8"));
    expect(sharedConfig.corpusRoot).toBe("memory");
  }, 15_000);
});
