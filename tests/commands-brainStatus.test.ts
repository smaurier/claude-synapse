import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBrainStatus } from "../src/commands/brainStatus.js";
import { writeLocalConfig, writeSharedConfig, DEFAULT_SHARED_CONFIG } from "../src/config/config.js";
import { createLink } from "../src/jonction/jonction.js";

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
  rmSync(root, { recursive: true, force: true });
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
