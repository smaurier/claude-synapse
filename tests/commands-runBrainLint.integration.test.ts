import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBrainLint } from "../src/commands/runBrainLint.js";
import { writeLocalConfig } from "../src/config/config.js";

// Real model — slow, own file, same rationale as the other
// *.integration.test.ts files.

let root: string;
let pluginDataDir: string;
let hubDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-runbrainlint-"));
  pluginDataDir = join(root, "plugin-data");
  hubDir = join(root, "hub");
  mkdirSync(pluginDataDir, { recursive: true });
  mkdirSync(hubDir, { recursive: true });
  writeLocalConfig(join(pluginDataDir, "local-config.json"), {
    hubUrl: "git@github.com:example-user/my-hub.git",
    hubClonePath: hubDir,
    machineId: "test-machine",
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runBrainLint", () => {
  it("reports frontmatter findings and near-duplicate files as merge candidates", async () => {
    writeFileSync(
      join(hubDir, "a.md"),
      "---\nname: a\ndescription: le chat dort sur le canapé\nmetadata:\n  type: reference\n---\nLe chat dort sur le canapé toute la journée.",
      "utf8",
    );
    writeFileSync(
      join(hubDir, "b.md"),
      "---\nname: b\ndescription: le chat dort sur le canapé aussi\nmetadata:\n  type: reference\n---\nLe chat dort sur le canapé toute la journée.",
      "utf8",
    );
    writeFileSync(join(hubDir, "cassé.md"), "pas de frontmatter du tout", "utf8");

    const report = await runBrainLint(pluginDataDir);

    expect(report.findings.some((f) => f.path === "cassé.md")).toBe(true);
    expect(report.mergeCandidates.some((c) => [c.a, c.b].includes("a.md") && [c.a, c.b].includes("b.md"))).toBe(true);
  }, 120_000);
});
