import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { showSynapseConfig, setSynapseConfig, forgetMachine } from "../src/commands/synapseConfig.js";
import { writeLocalConfig, DEFAULT_SHARED_CONFIG } from "../src/config/config.js";
import { rmTree } from "./helpers/fsTemp.js";

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
  rmTree(root);
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

  // Added 14/08: the user wanted to add watch sources (competitors/
  // inspirations) without waiting for a new plugin version.
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

// Added 12/10/2026: the machine registry only ever grew. `recordMachineSeen`
// adds on every SessionStart and nothing removed, so a retired machine
// (poste LR, handed back, its git-crypt key revoked) stayed listed forever —
// and `knownMachines` is deliberately absent from EDITABLE_KEYS, so
// /synapse-config set could not do it either. The only remaining option was
// hand-editing the hub's config.json, which is exactly what this command
// exists to make unnecessary.
describe("forgetMachine", () => {
  it("removes a retired machine from the registry and persists it", async () => {
    const { recordMachineSeen } = await import("../src/config/config.js");
    recordMachineSeen(hubDir, "poste-rendu");
    recordMachineSeen(hubDir, "poste-garde");

    const updated = await forgetMachine(pluginDataDir, "poste-rendu");

    expect(Object.keys(updated.knownMachines)).toEqual(["poste-garde"]);
    expect((await showSynapseConfig(pluginDataDir)).knownMachines).not.toHaveProperty("poste-rendu");
  });

  // Typo protection: silently succeeding on a name that was never there
  // would read as "done" while the real entry stays listed.
  it("refuses an unknown machine id and names the ones it knows", async () => {
    const { recordMachineSeen } = await import("../src/config/config.js");
    recordMachineSeen(hubDir, "poste-garde");

    await expect(forgetMachine(pluginDataDir, "poste-fantome")).rejects.toThrow(/poste-garde/);
  });

  // The SessionStart hook re-adds the current machine immediately, so this
  // would look like it worked and silently undo itself.
  it("refuses to forget the machine it is running on", async () => {
    const { recordMachineSeen } = await import("../src/config/config.js");
    recordMachineSeen(hubDir, "test-machine");

    await expect(forgetMachine(pluginDataDir, "test-machine")).rejects.toThrow(/ce poste/);
  });

  it("refuses when the hub lock is already held by another machine", async () => {
    const { recordMachineSeen } = await import("../src/config/config.js");
    recordMachineSeen(hubDir, "poste-rendu");
    const { acquireLock } = await import("../src/lock/lock.js");
    acquireLock(hubDir, "autre-machine", 10);

    await expect(forgetMachine(pluginDataDir, "poste-rendu")).rejects.toThrow(/verrou/);
  });

  it("leaves every other config field untouched", async () => {
    const { recordMachineSeen } = await import("../src/config/config.js");
    recordMachineSeen(hubDir, "poste-rendu");
    await setSynapseConfig(pluginDataDir, "wipLimit", "9");

    const updated = await forgetMachine(pluginDataDir, "poste-rendu");

    expect(updated.wipLimit).toBe(9);
    expect(updated.corpusRoot).toBe(DEFAULT_SHARED_CONFIG.corpusRoot);
  });
});
