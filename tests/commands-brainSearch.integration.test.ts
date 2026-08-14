import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBrainSearch } from "../src/commands/brainSearch.js";
import { writeLocalConfig } from "../src/config/config.js";

// Real model — proves the actual CLI-facing entrypoint (LocalConfig
// resolution included), not just searchHub.ts in isolation. Slow, own file,
// same rationale as the other *.integration.test.ts files.

let pluginDataDir: string;
let hubDir: string;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "synapse-cmd-brainsearch-"));
  pluginDataDir = join(root, "plugin-data");
  hubDir = join(root, "hub");
  mkdirSync(pluginDataDir, { recursive: true });
  mkdirSync(hubDir, { recursive: true });
});

afterEach(() => {
  rmSync(join(pluginDataDir, ".."), { recursive: true, force: true });
});

describe("runBrainSearch", () => {
  it("throws a clear error when no LocalConfig was ever initialized", async () => {
    await expect(runBrainSearch(pluginDataDir, "peu importe")).rejects.toThrow(/synapse-init/);
  });

  it("resolves the hub from LocalConfig and finds the most relevant file", async () => {
    writeLocalConfig(join(pluginDataDir, "local-config.json"), {
      hubUrl: "git@github.com:example-user/my-hub.git",
      hubClonePath: hubDir,
      machineId: "test-machine",
    });
    writeFileSync(join(hubDir, "chat.md"), "Le chat dort sur le canapé toute la journée.", "utf8");
    writeFileSync(join(hubDir, "voiture.md"), "La voiture roule vite sur l'autoroute.", "utf8");

    const results = await runBrainSearch(pluginDataDir, "un animal qui dort sur le canapé", 1);

    expect(results[0]?.path).toBe("chat.md");
  }, 120_000);
});
