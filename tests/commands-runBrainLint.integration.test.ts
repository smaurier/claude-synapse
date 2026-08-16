import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBrainLint } from "../src/commands/runBrainLint.js";
import { writeLocalConfig, writeSharedConfig, DEFAULT_SHARED_CONFIG } from "../src/config/config.js";

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

  // Regression (14/08, found on the real 121-file hub): findMergeCandidates
  // used to embed each file's full raw content directly, triggering
  // embedLocal's own "shouldn't happen" truncation warning for every file
  // over ~128 tokens. Proves the real pipeline (not just the fake-embed
  // unit test) chunks first — the warning must never fire here.
  it("never triggers the model's truncation warning — proves real chunking, not raw full-file embedding", async () => {
    const longContent = "Décision du 22/07/2026 sur le projet Synapse et son architecture. ".repeat(30);
    writeFileSync(
      join(hubDir, "long.md"),
      `---\nname: long\ndescription: x\nmetadata:\n  type: reference\n---\n${longContent}`,
      "utf8",
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runBrainLint(pluginDataDir);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("dépasse la limite"));
    warnSpy.mockRestore();
  }, 120_000);

  // Ajouté 16/08 (scripts/scale-test.mjs) : findMergeCandidates est O(n²),
  // mesuré 117s a 2000 fichiers synthétiques — au-dela du seuil configuré,
  // le sauter et le signaler plutot que de risquer un hang/timeout de hook.
  it("skips merge-candidate detection above the configured file-count threshold, with a warning", async () => {
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
    writeSharedConfig(hubDir, { ...DEFAULT_SHARED_CONFIG, mergeCandidatesMaxFiles: 1 });

    const report = await runBrainLint(pluginDataDir);

    expect(report.mergeCandidates).toEqual([]);
    expect(report.findings.some((f) => f.path === "(corpus)" && /fusion/.test(f.message))).toBe(true);
  }, 120_000);
});
