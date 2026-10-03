import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBrainStatus } from "../src/commands/brainStatus.js";
import { writeLocalConfig, writeSharedConfig, DEFAULT_SHARED_CONFIG } from "../src/config/config.js";
import { createLink } from "../src/jonction/jonction.js";
import { rmTree } from "./helpers/fsTemp.js";

let root: string;
let pluginDataDir: string;
let hubDir: string;
let linkPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-status-"));
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
  rmTree(root);
});

describe("getBrainStatus", () => {
  it("reports link state, file count, and audit cadence for a healthy setup", async () => {
    writeFileSync(join(hubDir, "a.md"), "un", "utf8");
    writeFileSync(join(hubDir, "b.md"), "deux", "utf8");
    createLink(hubDir, linkPath);
    writeSharedConfig(hubDir, { ...DEFAULT_SHARED_CONFIG, lastAuditAt: "2026-08-01T00:00:00.000Z" });

    const status = await getBrainStatus(pluginDataDir, linkPath);

    expect(status.linkState).toBe("ok");
    expect(status.fileCount).toBe(2);
    expect(status.lastAuditAt).toBe("2026-08-01T00:00:00.000Z");
    expect(status.auditCadenceDays).toBe(DEFAULT_SHARED_CONFIG.auditCadenceDays);
  });

  it("reports 'missing' when the link was never created", async () => {
    const status = await getBrainStatus(pluginDataDir, linkPath);
    expect(status.linkState).toBe("missing");
  });
});

// Ajouté 03/10 : constaté en conditions réelles sur le hub de la tour.
// loadHubCorpus() existe précisément pour répondre à « quel dossier, pour CE
// hub » via SharedConfig.corpusRoot, et son commentaire nomme ses appelants :
// searchHub / hybridSearchHub / refreshHubIndex. brainStatus, runBrainLint et
// synapseDoctor appelaient loadCorpus(hubClonePath) en direct et comptaient
// donc tout le hub — archives, fiches d'entretien, brouillons — comme s'il
// s'agissait de mémoires.
describe("getBrainStatus — corpusRoot", () => {
  it("ne compte que les fichiers du corpusRoot, pas tout le hub", async () => {
    mkdirSync(join(hubDir, "memory"), { recursive: true });
    mkdirSync(join(hubDir, "archive"), { recursive: true });
    writeFileSync(join(hubDir, "memory", "a.md"), "une mémoire", "utf8");
    writeFileSync(join(hubDir, "memory", "b.md"), "une autre", "utf8");
    writeFileSync(join(hubDir, "archive", "vieux-journal.md"), "pas une mémoire", "utf8");
    writeFileSync(join(hubDir, "PARCOURS.md"), "pas une mémoire non plus", "utf8");
    writeSharedConfig(hubDir, { ...DEFAULT_SHARED_CONFIG, corpusRoot: "memory" });
    createLink(hubDir, linkPath);

    const status = await getBrainStatus(pluginDataDir, linkPath);

    expect(status.fileCount).toBe(2);
  });
});
