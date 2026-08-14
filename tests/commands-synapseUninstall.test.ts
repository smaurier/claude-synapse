import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSynapseUninstall } from "../src/commands/synapseUninstall.js";
import { writeLocalConfig } from "../src/config/config.js";
import { createLink } from "../src/jonction/jonction.js";

let root: string;
let pluginDataDir: string;
let hubDir: string;
let linkPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-uninstall-"));
  pluginDataDir = join(root, "plugin-data");
  hubDir = join(root, "hub");
  linkPath = join(root, "project", "memory");
  mkdirSync(pluginDataDir, { recursive: true });
  mkdirSync(hubDir, { recursive: true });
  mkdirSync(join(root, "project"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runSynapseUninstall", () => {
  it("removes the link and the local config, leaves the hub clone untouched", async () => {
    createLink(hubDir, linkPath);
    writeLocalConfig(join(pluginDataDir, "local-config.json"), {
      hubUrl: "git@github.com:example-user/my-hub.git",
      hubClonePath: hubDir,
      machineId: "test-machine",
    });
    writeFileSync(join(hubDir, "memoire-reelle.md"), "ne jamais supprimer");

    const result = await runSynapseUninstall({ pluginDataDir, linkPath });

    expect(result).toEqual({ linkRemoved: true, localConfigRemoved: true });
    expect(existsSync(linkPath)).toBe(false);
    expect(existsSync(join(pluginDataDir, "local-config.json"))).toBe(false);
    // The hub itself — a real git clone the user may still want — survives.
    expect(existsSync(join(hubDir, "memoire-reelle.md"))).toBe(true);
  });

  it("is a safe no-op when nothing was ever installed", async () => {
    const result = await runSynapseUninstall({ pluginDataDir, linkPath });
    expect(result).toEqual({ linkRemoved: false, localConfigRemoved: false });
  });

  it("never touches a real directory at linkPath that isn't actually a link", async () => {
    mkdirSync(linkPath, { recursive: true });
    writeFileSync(join(linkPath, "precieux.md"), "contenu reel, pas un lien");

    const result = await runSynapseUninstall({ pluginDataDir, linkPath });

    expect(result.linkRemoved).toBe(false);
    expect(existsSync(join(linkPath, "precieux.md"))).toBe(true);
  });
});
