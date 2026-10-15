import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBrainLint } from "../src/commands/runBrainLint.js";
import { comparableWords, shingles, containment } from "../src/commands/brainLint.js";
import { writeLocalConfig } from "../src/config/config.js";
import { rmTree } from "./helpers/fsTemp.js";

// Was gated behind describeWithModel (real embedding model, own file, slow)
// until item 44 (15/10/2026) replaced the RAG-similarity merge-candidate
// check with findDuplicateCandidates — two deterministic rules, zero model
// calls. runBrainLint no longer touches embedLocal/chunkFileForEmbedding/
// ensurePinnedEmbeddingModel at all, so this file no longer needs the model
// gate and runs in milliseconds instead of the minutes a real embedding call
// used to cost.

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
  rmTree(root);
});

describe("runBrainLint", () => {
  it("reports frontmatter findings and slug-collision duplicates", async () => {
    // Same radical ("sujet") under two different type prefixes — the slug
    // rule (findSlugCollisions) is the one meant to catch this.
    writeFileSync(
      join(hubDir, "project_sujet.md"),
      "---\nname: a\ndescription: un sujet du point de vue projet\nmetadata:\n  type: project\n  created: 2026-08-01\n  expires: ongoing\n---\n\nContenu projet.",
      "utf8",
    );
    writeFileSync(
      join(hubDir, "reference_sujet.md"),
      "---\nname: b\ndescription: le même sujet du point de vue référence\nmetadata:\n  type: reference\n---\n\nContenu référence.",
      "utf8",
    );
    writeFileSync(join(hubDir, "cassé.md"), "pas de frontmatter du tout", "utf8");

    const report = await runBrainLint(pluginDataDir);

    expect(report.findings.some((f) => f.path === "cassé.md")).toBe(true);
    expect(report.duplicateCandidates).toHaveLength(1);
    expect(report.duplicateCandidates[0]).toMatchObject({ rule: "slug", stem: "sujet" });
    expect([report.duplicateCandidates[0]!.a, report.duplicateCandidates[0]!.b].sort()).toEqual([
      "project_sujet.md",
      "reference_sujet.md",
    ]);
  });

  // Same fixture shape as the unit-level "rend un candidat `rule: verbatim`"
  // test in commands-brainLint.test.ts — reused here so the verbatim path is
  // also proven through the real entry point (readLocalConfig, loadHubCorpus,
  // checkCitedCodeDrift and all), not just the pure function in isolation.
  // Filenames carry no recognised slug prefix, so the slug rule cannot fire
  // regardless of content — only the verbatim rule is in play.
  it("reports a verbatim-only duplicate end to end, with no slug collision possible", async () => {
    const bodyA =
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen";
    const bodyB = "one two three four five six seven eight nine ten eleven twelve extra extra different stuff here";
    writeFileSync(
      join(hubDir, "doc-un.md"),
      `---\nname: a\ndescription: x\nmetadata:\n  type: reference\n---\n\n${bodyA}`,
      "utf8",
    );
    writeFileSync(
      join(hubDir, "doc-deux.md"),
      `---\nname: b\ndescription: y\nmetadata:\n  type: reference\n---\n\n${bodyB}`,
      "utf8",
    );

    const expectedContainment = containment(shingles(comparableWords(bodyA), 8), shingles(comparableWords(bodyB), 8));

    const report = await runBrainLint(pluginDataDir);

    expect(report.duplicateCandidates).toHaveLength(1);
    expect(report.duplicateCandidates[0]).toMatchObject({ rule: "verbatim", shingleSize: 8 });
    expect(report.duplicateCandidates[0]?.containment).toBeCloseTo(expectedContainment, 10);
  });

  // The load-bearing proof that runBrainLint never touches the embedding
  // model is static, not this assertion: no import of embedLocal,
  // chunkFileForEmbedding, or ensurePinnedEmbeddingModel survives anywhere
  // in runBrainLint.ts's import graph (see the file-by-file change in item
  // 44). This test is a narrower, symptom-level guard on top of that — if
  // something regressed and started routing through the model again on long
  // content, the model's own truncation warning would fire here. Also no
  // longer needs the long timeout this file carried under the model gate.
  it("never touches the embedding model — no truncation warning, no model call", async () => {
    const longContent = "Décision du 22/07/2026 sur le projet Synapse et son architecture. ".repeat(30);
    writeFileSync(
      join(hubDir, "long.md"),
      `---\nname: long\ndescription: x\nmetadata:\n  type: reference\n---\n${longContent}`,
      "utf8",
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runBrainLint(pluginDataDir);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
