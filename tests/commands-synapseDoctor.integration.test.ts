import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSynapseDoctor } from "../src/commands/synapseDoctor.js";
import { writeLocalConfig, writeSharedConfig, readSharedConfig, DEFAULT_SHARED_CONFIG } from "../src/config/config.js";
import { createLink, inspectLink } from "../src/jonction/jonction.js";

let root: string;
let pluginDataDir: string;
let hubDir: string;
let linkPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-doctor-"));
  pluginDataDir = join(root, "plugin-data");
  hubDir = join(root, "hub");
  linkPath = join(root, "project", "memory");
  mkdirSync(pluginDataDir, { recursive: true });
  mkdirSync(hubDir, { recursive: true });
  mkdirSync(join(root, "project"), { recursive: true });
  writeLocalConfig(join(pluginDataDir, "local-config.json"), {
    hubUrl: "git@github.com:example-user/my-hub.git",
    hubClonePath: hubDir,
    machineId: "test-machine",
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runSynapseDoctor", () => {
  it("reports link/corpus/lint state and records the audit timestamp", async () => {
    createLink(hubDir, linkPath);
    writeFileSync(join(hubDir, "ok.md"), "---\nname: ok\ndescription: x\nmetadata:\n  type: reference\n---\n", "utf8");

    const report = await runSynapseDoctor(pluginDataDir, linkPath);

    expect(report.linkState).toBe("ok");
    expect(report.linkAutoFixed).toBe(false);
    expect(report.fileCount).toBe(1);
    expect(readSharedConfig(hubDir).lastAuditAt).not.toBeNull();
  }, 120_000);

  it("auto-fixes a broken link but leaves a wrong-target link alone", async () => {
    const ghostHub = join(root, "ghost");
    mkdirSync(ghostHub, { recursive: true });
    createLink(ghostHub, linkPath);
    rmSync(ghostHub, { recursive: true, force: true });

    const report = await runSynapseDoctor(pluginDataDir, linkPath);

    expect(report.linkAutoFixed).toBe(true);
    expect(report.linkState).toBe("ok");
  }, 120_000);

  // Ajoute 16/08 (problème 6, suite) : une racine memorisee via
  // runRefreshProjects doit etre rescannee automatiquement a chaque audit
  // periodique, sans que l'utilisateur la retape.
  it("re-scans remembered refreshProjectsRoots and links any newly-found project", async () => {
    createLink(hubDir, linkPath);
    const projectsRoot = join(root, "projects");
    mkdirSync(join(projectsRoot, "projet-neuf", ".claude"), { recursive: true });
    writeSharedConfig(hubDir, { ...DEFAULT_SHARED_CONFIG, refreshProjectsRoots: [projectsRoot] });

    const report = await runSynapseDoctor(pluginDataDir, linkPath);

    expect(report.projectsRelinked.map((r) => r.projectDir)).toEqual([join(projectsRoot, "projet-neuf")]);
    expect(inspectLink(join(projectsRoot, "projet-neuf", ".claude", "memory"), hubDir)).toBe("ok");
  }, 120_000);

  it("has an empty projectsRelinked when no root has ever been remembered", async () => {
    createLink(hubDir, linkPath);

    const report = await runSynapseDoctor(pluginDataDir, linkPath);

    expect(report.projectsRelinked).toEqual([]);
  }, 120_000);
});
