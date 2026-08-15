import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { showSynapseConfig, setSynapseConfig } from "../src/commands/synapseConfig.js";
import { writeLocalConfig, DEFAULT_SHARED_CONFIG } from "../src/config/config.js";

let root: string;
let pluginDataDir: string;
let hubDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-config-cmd-"));
  pluginDataDir = join(root, "plugin-data");
  hubDir = join(root, "hub");
  mkdirSync(pluginDataDir, { recursive: true });
  mkdirSync(hubDir, { recursive: true });
  writeLocalConfig(join(pluginDataDir, "local-config.json"), {
    hubUrl: "git@github.com:example-user/my-hub.git",
    hubClonePath: hubDir,
    machineId: "test-machine",
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("showSynapseConfig", () => {
  it("returns defaults for a hub with no config written yet", async () => {
    expect(await showSynapseConfig(pluginDataDir)).toEqual(DEFAULT_SHARED_CONFIG);
  });
});

describe("setSynapseConfig", () => {
  it("updates an editable key and persists it", async () => {
    const updated = await setSynapseConfig(pluginDataDir, "lockTimeoutMinutes", "42");
    expect(updated.lockTimeoutMinutes).toBe(42);
    expect((await showSynapseConfig(pluginDataDir)).lockTimeoutMinutes).toBe(42);
  });

  // Added 14/08: found hardcoded at 5 with no way to adjust it, flagged as
  // noise on a real hub with far more active projects than that default.
  it("makes wipLimit configurable (was hardcoded, no way to raise it for a bigger real hub)", async () => {
    const updated = await setSynapseConfig(pluginDataDir, "wipLimit", "40");
    expect(updated.wipLimit).toBe(40);
  });

  it("refuses to set a non-editable key", async () => {
    await expect(setSynapseConfig(pluginDataDir, "version", "2")).rejects.toThrow(/non modifiable/);
  });

  it("refuses a non-numeric value", async () => {
    await expect(setSynapseConfig(pluginDataDir, "lockTimeoutMinutes", "bientot")).rejects.toThrow(/invalide/);
  });

  it("refuses when the hub lock is already held by another machine", async () => {
    const { acquireLock } = await import("../src/lock/lock.js");
    acquireLock(hubDir, "autre-machine", 10);

    await expect(setSynapseConfig(pluginDataDir, "lockTimeoutMinutes", "5")).rejects.toThrow(/verrou/);
  });

  // Ajouté 14/08 : Sylvain a demande a pouvoir ajouter des sources de veille
  // (concurrents/inspirations) sans attendre une nouvelle version du plugin.
  it("parses marketWatchExtraSources as a comma-separated list of owner/repo entries", async () => {
    const updated = await setSynapseConfig(pluginDataDir, "marketWatchExtraSources", "someone/repo, other/thing");
    expect(updated.marketWatchExtraSources).toEqual(["someone/repo", "other/thing"]);
  });

  it("parses refreshProjectsExclusions as a comma-separated list of exact directory names", async () => {
    const updated = await setSynapseConfig(pluginDataDir, "refreshProjectsExclusions", "archive, node_modules,old-stuff");
    expect(updated.refreshProjectsExclusions).toEqual(["archive", "node_modules", "old-stuff"]);
  });

  it("sets an empty exclusions list from an empty string", async () => {
    const updated = await setSynapseConfig(pluginDataDir, "refreshProjectsExclusions", "");
    expect(updated.refreshProjectsExclusions).toEqual([]);
  });
});
