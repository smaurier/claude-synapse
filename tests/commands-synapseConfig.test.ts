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
});
