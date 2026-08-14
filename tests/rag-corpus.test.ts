import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCorpus } from "../src/rag/corpus.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-rag-corpus-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("loadCorpus", () => {
  it("reads markdown files at the root", () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "a.md"), "contenu a", "utf8");

    const corpus = loadCorpus(root);

    expect(corpus).toEqual([{ path: "a.md", content: "contenu a" }]);
  });

  it("walks nested directories and returns forward-slash relative paths", () => {
    mkdirSync(join(root, "sous-dossier"), { recursive: true });
    writeFileSync(join(root, "sous-dossier", "b.md"), "contenu b", "utf8");

    const corpus = loadCorpus(root);

    expect(corpus).toEqual([{ path: "sous-dossier/b.md", content: "contenu b" }]);
  });

  it("skips non-markdown files", () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "a.md"), "contenu a", "utf8");
    writeFileSync(join(root, "notes.txt"), "ignore-moi", "utf8");

    const corpus = loadCorpus(root);

    expect(corpus).toEqual([{ path: "a.md", content: "contenu a" }]);
  });

  it("skips .git, node_modules and .synapse directories entirely", () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "a.md"), "contenu a", "utf8");
    for (const dir of [".git", "node_modules", ".synapse"]) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "should-not-appear.md"), "piege", "utf8");
    }

    const corpus = loadCorpus(root);

    expect(corpus).toEqual([{ path: "a.md", content: "contenu a" }]);
  });

  it("returns results sorted by path, order-independent from directory listing", () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "z.md"), "z", "utf8");
    writeFileSync(join(root, "a.md"), "a", "utf8");

    const corpus = loadCorpus(root);

    expect(corpus.map((f) => f.path)).toEqual(["a.md", "z.md"]);
  });

  it("returns an empty array for a hub with no markdown files", () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "notes.txt"), "rien ici", "utf8");

    expect(loadCorpus(root)).toEqual([]);
  });
});
