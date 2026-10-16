import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSynapseDoctor } from "../src/commands/synapseDoctor.js";
import { writeLocalConfig, writeSharedConfig, readSharedConfig, DEFAULT_SHARED_CONFIG } from "../src/config/config.js";
import { createLink, inspectLink } from "../src/jonction/jonction.js";
import { rmTree } from "./helpers/fsTemp.js";
import { describeWithModel } from "./helpers/model.js";

let root: string;
let pluginDataDir: string;
let hubDir: string;
let linkPath: string;
// pluginRoot est désormais un paramètre OBLIGATOIRE de runSynapseDoctor
// (backlog 49, suite au signalement du coordinateur : un garde optionnel
// est un garde qui pourrit). Ce dossier n'a volontairement PAS de
// package.json : collectDependencyFindings échoue alors en silence et rend
// [] immédiatement, sans jamais shellé un vrai `npm` — hermétique et rapide
// pour les tests ci-dessous qui ne portent pas sur cette vérification elle-
// même (celle-ci a son propre test dédié, avec un vrai package.json).
let pluginRootWithoutPackageJson: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-doctor-"));
  pluginDataDir = join(root, "plugin-data");
  hubDir = join(root, "hub");
  linkPath = join(root, "project", "memory");
  pluginRootWithoutPackageJson = join(root, "plugin-root-sans-package-json");
  mkdirSync(pluginDataDir, { recursive: true });
  mkdirSync(hubDir, { recursive: true });
  mkdirSync(join(root, "project"), { recursive: true });
  mkdirSync(pluginRootWithoutPackageJson, { recursive: true });
  writeLocalConfig(join(pluginDataDir, "local-config.json"), {
    hubUrl: "git@github.com:example-user/my-hub.git",
    hubClonePath: hubDir,
    machineId: "test-machine",
  });
});

afterEach(() => {
  rmTree(root);
});

describeWithModel("runSynapseDoctor", () => {
  it("reports link/corpus/lint state and records the audit timestamp", async () => {
    createLink(hubDir, linkPath);
    writeFileSync(join(hubDir, "ok.md"), "---\nname: ok\ndescription: x\nmetadata:\n  type: reference\n---\n", "utf8");

    const report = await runSynapseDoctor(pluginDataDir, linkPath, pluginRootWithoutPackageJson);

    expect(report.linkState).toBe("ok");
    expect(report.linkAutoFixed).toBe(false);
    expect(report.fileCount).toBe(1);
    expect(readSharedConfig(hubDir).lastAuditAt).not.toBeNull();
  }, 120_000);

  it("auto-fixes a broken link but leaves a wrong-target link alone", async () => {
    const ghostHub = join(root, "ghost");
    mkdirSync(ghostHub, { recursive: true });
    createLink(ghostHub, linkPath);
    rmTree(ghostHub);

    const report = await runSynapseDoctor(pluginDataDir, linkPath, pluginRootWithoutPackageJson);

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

    const report = await runSynapseDoctor(pluginDataDir, linkPath, pluginRootWithoutPackageJson);

    expect(report.projectsRelinked.map((r) => r.projectDir)).toEqual([join(projectsRoot, "projet-neuf")]);
    expect(inspectLink(join(projectsRoot, "projet-neuf", ".claude", "memory"), hubDir)).toBe("ok");
  }, 120_000);

  it("has an empty projectsRelinked when no root has ever been remembered", async () => {
    createLink(hubDir, linkPath);

    const report = await runSynapseDoctor(pluginDataDir, linkPath, pluginRootWithoutPackageJson);

    expect(report.projectsRelinked).toEqual([]);
  }, 120_000);

  // Backlog 49 : contrairement aux tests ci-dessus (pluginRootWithoutPackageJson,
  // qui ne porte pas de package.json et fait donc échouer collectDependencyFindings
  // en silence), celui-ci pointe vers un vrai package.json : le vrai `npm
  // audit`/`npm outdated` tourne réellement dans pluginRoot, sans jamais
  // faire planter le rapport même sans node_modules ni package-lock.json.
  it("stays wired to the real dependency check when pluginRoot is given, without ever failing the report", async () => {
    createLink(hubDir, linkPath);
    const pluginRoot = join(root, "fake-plugin-root");
    mkdirSync(pluginRoot, { recursive: true });
    writeFileSync(join(pluginRoot, "package.json"), JSON.stringify({ name: "fake-plugin", version: "1.0.0" }), "utf8");

    const report = await runSynapseDoctor(pluginDataDir, linkPath, pluginRoot);

    expect(report.findings).toBeInstanceOf(Array);
  }, 120_000);
});
