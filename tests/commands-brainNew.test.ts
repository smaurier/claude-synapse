import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryFile } from "../src/commands/brainNew.js";
import { writeSharedConfig, DEFAULT_SHARED_CONFIG } from "../src/config/config.js";

let hubDir: string;

beforeEach(() => {
  hubDir = mkdtempSync(join(tmpdir(), "synapse-brainnew-"));
});

afterEach(() => {
  rmSync(hubDir, { recursive: true, force: true });
});

describe("createMemoryFile", () => {
  it("creates a slugified file with the expected frontmatter for a simple type", () => {
    const result = createMemoryFile(hubDir, "reference", "Repo privé");

    expect(result.slug).toBe("repo-prive");
    const content = readFileSync(result.path, "utf8");
    expect(content).toContain("name: repo-prive");
    expect(content).toContain("type: reference");
    expect(content).not.toContain("created:"); // reference is implicitly ongoing, no dates
  });

  it("adds created/expires for project and feedback types (dated-memory convention)", () => {
    const result = createMemoryFile(hubDir, "project", "Refonte du site");
    const content = readFileSync(result.path, "utf8");
    expect(content).toContain("created:");
    expect(content).toContain("expires: ongoing");
  });

  it("rejects an invalid type", () => {
    expect(() => createMemoryFile(hubDir, "invalide" as never, "x")).toThrow(/invalide/);
  });

  it("refuses to overwrite an existing memory file", () => {
    createMemoryFile(hubDir, "user", "Doublon");
    expect(() => createMemoryFile(hubDir, "user", "Doublon")).toThrow(/existe déjà/);
  });

  it("nests memory files inside subdirectories transparently (mirrors mkdir -p)", () => {
    mkdirSync(join(hubDir, "sous-dossier"), { recursive: true });
    const result = createMemoryFile(join(hubDir, "sous-dossier"), "user", "test");
    expect(result.path).toBe(join(hubDir, "sous-dossier", "test.md"));
  });

  it("respects a narrowed corpusRoot in the hub's shared config, instead of always writing at hub root", () => {
    // Real-world trigger: a hub whose SharedConfig.corpusRoot narrows the RAG
    // scan to a subdirectory (e.g. "memory", alongside non-memory material
    // like docs/progress files at the hub root) — new memories must land
    // inside that subdirectory, or they're invisible to search/lint alike.
    writeSharedConfig(hubDir, { ...DEFAULT_SHARED_CONFIG, corpusRoot: "memory" });
    mkdirSync(join(hubDir, "memory"), { recursive: true });

    const result = createMemoryFile(hubDir, "reference", "Repo privé");

    expect(result.path).toBe(join(hubDir, "memory", "repo-prive.md"));
  });

  it("still writes at hub root when corpusRoot is the default '.'", () => {
    writeSharedConfig(hubDir, { ...DEFAULT_SHARED_CONFIG, corpusRoot: "." });
    const result = createMemoryFile(hubDir, "reference", "Repo privé");
    expect(result.path).toBe(join(hubDir, "repo-prive.md"));
  });
});
