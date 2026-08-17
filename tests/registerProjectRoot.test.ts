import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProjectRoot } from "../src/commands/registerProjectRoot.js";
import { readLocalConfig, defaultLocalConfigPath } from "../src/config/config.js";

// Backlog 16/08 (item 8, résolu le 17/08) : `metadata.cites: <path>` était
// bloqué sur "quel dépôt correspond à quel chemin" — les chemins sont
// spécifiques à une machine (feedback_chemins_multipostes), donc ce
// registre nom-de-projet -> chemin local vit dans LocalConfig (déjà la
// couche par-machine), jamais SharedConfig (déjà refusé par
// /synapse-config, réservé à SharedConfig par design).

let pluginDataDir: string;
let configPath: string;

beforeEach(() => {
  pluginDataDir = mkdtempSync(join(tmpdir(), "synapse-register-root-"));
  configPath = defaultLocalConfigPath(pluginDataDir);
  writeFileSync(configPath, JSON.stringify({ hubUrl: "file:///x", hubClonePath: "/hub", machineId: "m1" }), "utf8");
});

afterEach(() => {
  rmSync(pluginDataDir, { recursive: true, force: true });
});

describe("registerProjectRoot", () => {
  it("adds a new project root to a fresh LocalConfig with no registry yet", () => {
    registerProjectRoot(pluginDataDir, "claude-synapse", "C:\\Users\\exemple\\Documents\\projects\\claude-synapse");

    const updated = readLocalConfig(configPath);
    expect(updated.knownProjectRoots).toEqual({
      "claude-synapse": "C:\\Users\\exemple\\Documents\\projects\\claude-synapse",
    });
  });

  it("adds a second project without disturbing the first", () => {
    registerProjectRoot(pluginDataDir, "claude-synapse", "/path/a");
    registerProjectRoot(pluginDataDir, "radar-signaux", "/path/b");

    const updated = readLocalConfig(configPath);
    expect(updated.knownProjectRoots).toEqual({ "claude-synapse": "/path/a", "radar-signaux": "/path/b" });
  });

  it("overwrites the root for an already-registered project name", () => {
    registerProjectRoot(pluginDataDir, "claude-synapse", "/old/path");
    registerProjectRoot(pluginDataDir, "claude-synapse", "/new/path");

    expect(readLocalConfig(configPath).knownProjectRoots).toEqual({ "claude-synapse": "/new/path" });
  });

  it("preserves the rest of LocalConfig untouched", () => {
    registerProjectRoot(pluginDataDir, "claude-synapse", "/path/a");

    const updated = readLocalConfig(configPath);
    expect(updated.hubUrl).toBe("file:///x");
    expect(updated.machineId).toBe("m1");
  });
});
