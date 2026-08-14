import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRefreshIndex } from "../src/commands/refreshIndex.js";
import { writeLocalConfig } from "../src/config/config.js";

let pluginDataDir: string;
let hubDir: string;
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-cmd-refresh-"));
  pluginDataDir = join(root, "plugin-data");
  hubDir = join(root, "hub");
  mkdirSync(pluginDataDir, { recursive: true });
  mkdirSync(hubDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runRefreshIndex", () => {
  it("throws a clear error when no LocalConfig was ever initialized", async () => {
    await expect(runRefreshIndex(pluginDataDir)).rejects.toThrow(/synapse-init/);
  });

  it("builds the hub's index without needing a query", async () => {
    writeLocalConfig(join(pluginDataDir, "local-config.json"), {
      hubUrl: "git@github.com:example-user/my-hub.git",
      hubClonePath: hubDir,
      machineId: "test-machine",
    });
    writeFileSync(join(hubDir, "chat.md"), "Le chat dort sur le canapé.", "utf8");

    const result = await runRefreshIndex(pluginDataDir);

    expect(existsSync(join(hubDir, ".synapse", "index.sqlite"))).toBe(true);
    expect(result.auditTriggered).toBe(false); // no projectDir given — audit needs it for linkPath
  }, 120_000);

  it("triggers /synapse-doctor automatically when the audit cadence is overdue and a projectDir is given", async () => {
    writeLocalConfig(join(pluginDataDir, "local-config.json"), {
      hubUrl: "git@github.com:example-user/my-hub.git",
      hubClonePath: hubDir,
      machineId: "test-machine",
    });
    writeFileSync(join(hubDir, "chat.md"), "Le chat dort sur le canapé.", "utf8");
    const projectDir = join(root, "mon-projet");
    mkdirSync(join(projectDir, ".claude"), { recursive: true });

    const result = await runRefreshIndex(pluginDataDir, projectDir);

    expect(result.auditTriggered).toBe(true); // lastAuditAt was never set — overdue by definition
    expect(result.auditReport?.fileCount).toBe(1);
  }, 120_000);
});
