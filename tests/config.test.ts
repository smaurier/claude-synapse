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
  defaultLocalConfigPath,
  defaultHubClonePath,
  recordMachineSeen,
  resolveCorpusRoot,
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

// Ajouté 24/08 : "adopter un dossier existant comme hub" — le hub (là où vivent
// .git, le verrou, .synapse/) et le corpus indexé par le RAG ne sont pas
// toujours le même dossier (ex : le hub est la racine d'un repo qui contient
// aussi de la doc/scripts, la vraie mémoire n'est qu'un sous-dossier).
describe("resolveCorpusRoot", () => {
  it("defaults to the hub root itself when corpusRoot is unset (unchanged behavior)", () => {
    const hubDir = join(root, "hub");
    mkdirSync(hubDir, { recursive: true });
    expect(resolveCorpusRoot(hubDir)).toBe(hubDir);
  });

  it("resolves to a subdirectory of the hub when corpusRoot is configured", () => {
    const hubDir = join(root, "hub");
    mkdirSync(hubDir, { recursive: true });
    writeSharedConfig(hubDir, { ...DEFAULT_SHARED_CONFIG, corpusRoot: "memory" });
    expect(resolveCorpusRoot(hubDir)).toBe(join(hubDir, "memory"));
  });
});

// Ajoute 16/08 (revue concurrentielle) : registre des machines connues.
describe("recordMachineSeen (device registry)", () => {
  it("records a machine's presence with an ISO timestamp", () => {
    const hubDir = join(root, "hub");
    mkdirSync(hubDir, { recursive: true });

    recordMachineSeen(hubDir, "workstation-a", new Date("2026-08-16T12:00:00.000Z"));

    expect(readSharedConfig(hubDir).knownMachines).toEqual({ "workstation-a": "2026-08-16T12:00:00.000Z" });
  });

  it("updates an existing machine's timestamp without dropping other machines", () => {
    const hubDir = join(root, "hub");
    mkdirSync(hubDir, { recursive: true });

    recordMachineSeen(hubDir, "workstation-a", new Date("2026-08-16T12:00:00.000Z"));
    recordMachineSeen(hubDir, "workstation-b", new Date("2026-08-16T13:00:00.000Z"));
    recordMachineSeen(hubDir, "workstation-a", new Date("2026-08-16T14:00:00.000Z"));

    expect(readSharedConfig(hubDir).knownMachines).toEqual({
      "workstation-a": "2026-08-16T14:00:00.000Z",
      "workstation-b": "2026-08-16T13:00:00.000Z",
    });
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
      hubUrl: "git@github.com:example-user/my-hub.git",
      hubClonePath: join(root, "hub"),
      machineId: "workstation-a",
    });
    const cfg = readLocalConfig(localPath);
    expect(cfg.hubUrl).toBe("git@github.com:example-user/my-hub.git");
    expect(cfg.machineId).toBe("workstation-a");
  });

  it("requires a non-empty hubUrl", () => {
    const localPath = join(root, "local-config.json");
    expect(() =>
      writeLocalConfig(localPath, { hubUrl: "", hubClonePath: root, machineId: "x" }),
    ).toThrow(/hubUrl/);
  });
});

describe("default paths anchored to the plugin's per-machine data directory", () => {
  it("places local-config.json directly inside the given data directory", () => {
    const pluginDataDir = join(root, "plugin-data");
    expect(defaultLocalConfigPath(pluginDataDir)).toBe(join(pluginDataDir, "local-config.json"));
  });

  it("places the default hub clone in a hub/ subdirectory of the data directory", () => {
    const pluginDataDir = join(root, "plugin-data");
    expect(defaultHubClonePath(pluginDataDir)).toBe(join(pluginDataDir, "hub"));
  });
});
