import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSynapseDoctor } from "../src/commands/synapseDoctor.js";
import { writeLocalConfig, readSharedConfig } from "../src/config/config.js";
import { createLink } from "../src/jonction/jonction.js";

let root: string;
let pluginDataDir: string;
let hubDir: string;
let linkPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-doctor-"));
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
  rmSync(root, { recursive: true, force: true });
});

describe("runSynapseDoctor", () => {
  it("reports link/corpus/lint state and records the audit timestamp", async () => {
    createLink(hubDir, linkPath);
    writeFileSync(join(hubDir, "ok.md"), "---\nname: ok\ndescription: x\nmetadata:\n  type: reference\n---\n", "utf8");

    const report = await runSynapseDoctor(pluginDataDir, linkPath);

    expect(report.linkState).toBe("ok");
    expect(report.linkAutoFixed).toBe(false);
    expect(report.fileCount).toBe(1);
    expect(readSharedConfig(hubDir).lastAuditAt).not.toBeNull();
  }, 120_000);

  it("auto-fixes a broken link but leaves a wrong-target link alone", async () => {
    const ghostHub = join(root, "ghost");
    mkdirSync(ghostHub, { recursive: true });
    createLink(ghostHub, linkPath);
    rmSync(ghostHub, { recursive: true, force: true });

    const report = await runSynapseDoctor(pluginDataDir, linkPath);

    expect(report.linkAutoFixed).toBe(true);
    expect(report.linkState).toBe("ok");
  }, 120_000);
});
