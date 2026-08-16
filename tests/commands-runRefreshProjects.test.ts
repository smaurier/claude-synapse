import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRefreshProjects } from "../src/commands/runRefreshProjects.js";
import { writeLocalConfig, writeSharedConfig, DEFAULT_SHARED_CONFIG } from "../src/config/config.js";
import { inspectLink } from "../src/jonction/jonction.js";

let root: string;
let pluginDataDir: string;
let hubDir: string;
let projectsRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-run-refresh-projects-"));
  pluginDataDir = join(root, "plugin-data");
  hubDir = join(root, "hub");
  projectsRoot = join(root, "projects");
  mkdirSync(pluginDataDir, { recursive: true });
  mkdirSync(hubDir, { recursive: true });
  mkdirSync(projectsRoot, { recursive: true });
  writeLocalConfig(join(pluginDataDir, "local-config.json"), {
    hubUrl: "git@github.com:example-user/my-hub.git",
    hubClonePath: hubDir,
    machineId: "test-machine",
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runRefreshProjects", () => {
  it("links every discovered project using default (empty) exclusions", async () => {
    mkdirSync(join(projectsRoot, "projet-a", ".claude"), { recursive: true });

    const results = await runRefreshProjects(pluginDataDir, projectsRoot);

    expect(results).toHaveLength(1);
    expect(inspectLink(join(projectsRoot, "projet-a", ".claude", "memory"), hubDir)).toBe("ok");
  });

  it("reads exclusions from SharedConfig.refreshProjectsExclusions, not just a hardcoded default", async () => {
    mkdirSync(join(projectsRoot, "projet-a", ".claude"), { recursive: true });
    mkdirSync(join(projectsRoot, "archive", ".claude"), { recursive: true });
    writeSharedConfig(hubDir, { ...DEFAULT_SHARED_CONFIG, refreshProjectsExclusions: ["archive"] });

    const results = await runRefreshProjects(pluginDataDir, projectsRoot);

    expect(results.map((r) => r.projectDir)).toEqual([join(projectsRoot, "projet-a")]);
  });

  // Ajoute 16/08 : la racine donnee manuellement doit etre memorisee, pour
  // que /synapse-doctor puisse la rescanner tout seul aux audits suivants
  // sans que l'utilisateur la retape a chaque fois.
  it("persists the given root into SharedConfig.refreshProjectsRoots", async () => {
    await runRefreshProjects(pluginDataDir, projectsRoot);

    const { readSharedConfig } = await import("../src/config/config.js");
    expect(readSharedConfig(hubDir).refreshProjectsRoots).toEqual([projectsRoot]);
  });

  it("does not duplicate a root already remembered from a previous run", async () => {
    await runRefreshProjects(pluginDataDir, projectsRoot);
    await runRefreshProjects(pluginDataDir, projectsRoot);

    const { readSharedConfig } = await import("../src/config/config.js");
    expect(readSharedConfig(hubDir).refreshProjectsRoots).toEqual([projectsRoot]);
  });
});
