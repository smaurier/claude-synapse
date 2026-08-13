import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SHARED_CONFIG,
  readSharedConfig,
  writeSharedConfig,
  readLocalConfig,
  writeLocalConfig,
} from "../src/config/config.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-config-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("shared config (lives inside the hub, versioned, synced)", () => {
  it("returns defaults when no config file exists yet (first machine ever)", () => {
    const hubDir = join(root, "hub");
    mkdirSync(hubDir, { recursive: true });
    const cfg = readSharedConfig(hubDir);
    expect(cfg).toEqual(DEFAULT_SHARED_CONFIG);
  });

  it("round-trips a written config", () => {
    const hubDir = join(root, "hub");
    mkdirSync(hubDir, { recursive: true });
    writeSharedConfig(hubDir, { ...DEFAULT_SHARED_CONFIG, lockTimeoutMinutes: 5 });
    expect(readSharedConfig(hubDir).lockTimeoutMinutes).toBe(5);
  });

  it("merges missing fields with defaults (forward-compatible with older configs)", () => {
    const hubDir = join(root, "hub");
    mkdirSync(join(hubDir, ".synapse"), { recursive: true });
    // Simulate a config written by an older version of the plugin, missing a field.
    writeFileSync(join(hubDir, ".synapse", "config.json"), JSON.stringify({ version: 1, lockTimeoutMinutes: 20 }));
    const cfg = readSharedConfig(hubDir);
    expect(cfg.lockTimeoutMinutes).toBe(20);
    expect(cfg.auditCadenceDays).toBe(DEFAULT_SHARED_CONFIG.auditCadenceDays);
  });

  it("writes the config file inside the hub so it travels with git, not next to it", () => {
    const hubDir = join(root, "hub");
    mkdirSync(hubDir, { recursive: true });
    writeSharedConfig(hubDir, DEFAULT_SHARED_CONFIG);
    expect(existsSync(join(hubDir, ".synapse", "config.json"))).toBe(true);
  });
});

describe("local config (per-machine, outside the hub, never synced)", () => {
  it("throws when reading a local config that was never initialized", () => {
    const localPath = join(root, "local-config.json");
    expect(() => readLocalConfig(localPath)).toThrow();
  });

  it("round-trips a written local config", () => {
    const localPath = join(root, "local-config.json");
    writeLocalConfig(localPath, {
      hubUrl: "git@github.com:smaurier/my-hub.git",
      hubClonePath: join(root, "hub"),
      machineId: "lrtechnologies",
    });
    const cfg = readLocalConfig(localPath);
    expect(cfg.hubUrl).toBe("git@github.com:smaurier/my-hub.git");
    expect(cfg.machineId).toBe("lrtechnologies");
  });

  it("requires a non-empty hubUrl", () => {
    const localPath = join(root, "local-config.json");
    expect(() =>
      writeLocalConfig(localPath, { hubUrl: "", hubClonePath: root, machineId: "x" }),
    ).toThrow(/hubUrl/);
  });
});
