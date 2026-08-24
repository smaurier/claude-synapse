import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCorpus, loadHubCorpus } from "../src/rag/corpus.js";
import { DEFAULT_SHARED_CONFIG, writeSharedConfig } from "../src/config/config.js";

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

// Ajouté 24/08 : "adopter un dossier existant comme hub" — quand le hub est
// une racine de repo contenant aussi de la doc/scripts non-mémoire, seul un
// sous-dossier (typiquement "memory") doit être indexé par le RAG. C'est ce
// point d'intégration précis (config -> chemin réellement scanné) que
// searchHub.ts/hybridSearch.ts appellent désormais, pas loadCorpus() brut.
describe("loadHubCorpus (corpusRoot-aware)", () => {
  it("scans the whole hub when corpusRoot is unset (unchanged default behavior)", () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "a.md"), "contenu a", "utf8");

    expect(loadHubCorpus(root)).toEqual([{ path: "a.md", content: "contenu a" }]);
  });

  it("scans only the configured subdirectory, ignoring markdown outside it", () => {
    mkdirSync(join(root, "memory"), { recursive: true });
    writeFileSync(join(root, "memory", "vrai-souvenir.md"), "mémoire réelle", "utf8");
    writeFileSync(join(root, "PARCOURS.md"), "pas de la mémoire", "utf8");
    writeSharedConfig(root, { ...DEFAULT_SHARED_CONFIG, corpusRoot: "memory" });

    const corpus = loadHubCorpus(root);

    expect(corpus).toEqual([{ path: "vrai-souvenir.md", content: "mémoire réelle" }]);
  });
});
