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

    await runRefreshIndex(pluginDataDir);

    expect(existsSync(join(hubDir, ".synapse", "index.sqlite"))).toBe(true);
  }, 120_000);
});
