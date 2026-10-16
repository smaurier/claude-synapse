import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRefreshIndex } from "../src/commands/refreshIndex.js";
import { writeLocalConfig, readSharedConfig } from "../src/config/config.js";
import { rmTree } from "./helpers/fsTemp.js";
import { describeWithModel } from "./helpers/model.js";

let pluginDataDir: string;
let hubDir: string;
let root: string;
// pluginRoot est désormais un paramètre OBLIGATOIRE de runRefreshIndex
// (backlog 49, suite au signalement du coordinateur). Ce dossier n'a
// volontairement pas de package.json : quand /synapse-doctor tourne, la
// vérification de dépendances échoue en silence (pas de npm shellé) — les
// tests ci-dessous qui ne portent pas sur cette vérification restent donc
// rapides et hermétiques.
let pluginRootWithoutPackageJson: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-cmd-refresh-"));
  pluginDataDir = join(root, "plugin-data");
  hubDir = join(root, "hub");
  pluginRootWithoutPackageJson = join(root, "plugin-root-sans-package-json");
  mkdirSync(pluginDataDir, { recursive: true });
  mkdirSync(hubDir, { recursive: true });
  mkdirSync(pluginRootWithoutPackageJson, { recursive: true });
});

afterEach(() => {
  rmTree(root);
});

describeWithModel("runRefreshIndex", () => {
  it("throws a clear error when no LocalConfig was ever initialized", async () => {
    await expect(runRefreshIndex(pluginDataDir, undefined, pluginRootWithoutPackageJson)).rejects.toThrow(/synapse-init/);
  });

  it("builds the hub's index without needing a query", async () => {
    writeLocalConfig(join(pluginDataDir, "local-config.json"), {
      hubUrl: "git@github.com:example-user/my-hub.git",
      hubClonePath: hubDir,
      machineId: "test-machine",
    });
    writeFileSync(join(hubDir, "chat.md"), "Le chat dort sur le canapé.", "utf8");

    const result = await runRefreshIndex(pluginDataDir, undefined, pluginRootWithoutPackageJson);

    expect(existsSync(join(hubDir, ".synapse", "index.sqlite"))).toBe(true);
    expect(result.auditTriggered).toBe(false); // no projectDir given — audit needs it for linkPath
  }, 120_000);

  // Ajoute 16/08 : registre des machines (SharedConfig.knownMachines),
  // mis a jour a chaque SessionStart, meme sans projectDir.
  it("records this machine in the device registry", async () => {
    writeLocalConfig(join(pluginDataDir, "local-config.json"), {
      hubUrl: "git@github.com:example-user/my-hub.git",
      hubClonePath: hubDir,
      machineId: "workstation-a",
    });
    writeFileSync(join(hubDir, "chat.md"), "Le chat dort sur le canapé.", "utf8");

    await runRefreshIndex(pluginDataDir, undefined, pluginRootWithoutPackageJson);

    expect(readSharedConfig(hubDir).knownMachines).toHaveProperty("workstation-a");
  }, 120_000);

  it("triggers /synapse-doctor automatically when the audit cadence is overdue and a projectDir is given", async () => {
    writeLocalConfig(join(pluginDataDir, "local-config.json"), {
      hubUrl: "git@github.com:example-user/my-hub.git",
      hubClonePath: hubDir,
      machineId: "test-machine",
    });
    writeFileSync(join(hubDir, "chat.md"), "Le chat dort sur le canapé.", "utf8");
    const projectDir = join(root, "mon-projet");
    mkdirSync(join(projectDir, ".claude"), { recursive: true });

    const result = await runRefreshIndex(pluginDataDir, projectDir, pluginRootWithoutPackageJson);

    expect(result.auditTriggered).toBe(true); // lastAuditAt was never set — overdue by definition
    expect(result.auditReport?.fileCount).toBe(1);
  }, 120_000);

  // Backlog 49 : pluginRoot (calculé par refreshIndexCli.ts via
  // resolvePluginRoot) doit vraiment traverser runRefreshIndex jusqu'à
  // /synapse-doctor, avec un vrai package.json cette fois (contrairement
  // aux tests ci-dessus, qui utilisent pluginRootWithoutPackageJson parce
  // qu'ils ne portent pas sur cette vérification).
  it("threads pluginRoot through to /synapse-doctor without breaking the rest of the report", async () => {
    writeLocalConfig(join(pluginDataDir, "local-config.json"), {
      hubUrl: "git@github.com:example-user/my-hub.git",
      hubClonePath: hubDir,
      machineId: "test-machine",
    });
    writeFileSync(join(hubDir, "chat.md"), "Le chat dort sur le canapé.", "utf8");
    const projectDir = join(root, "mon-projet");
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    const pluginRoot = join(root, "fake-plugin-root");
    mkdirSync(pluginRoot, { recursive: true });
    writeFileSync(join(pluginRoot, "package.json"), JSON.stringify({ name: "fake-plugin", version: "1.0.0" }), "utf8");

    const result = await runRefreshIndex(pluginDataDir, projectDir, pluginRoot);

    expect(result.auditTriggered).toBe(true);
    expect(result.auditReport?.findings).toBeInstanceOf(Array);
  }, 120_000);
});
