import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VectorStore } from "../src/rag/store.js";
import { rebuildIfStale, stopAfter } from "../src/rag/search.js";
import type { Chunk } from "../src/rag/chunk.js";
import { rmTree } from "./helpers/fsTemp.js";

// 17/11/2026 : le délai du hook (120 s) ne tue pas un processus asynchrone, et
// un refresh n'avait aucune limite propre. Mesuré sur le poste pro : 170 s et
// 8 cœurs pour un seul fichier de 693 Ko. Le refresh s'arrête donc de
// lui-même, et ce qu'il n'a pas fini reste dans l'état d'avant.

const IDENTITY = "fake-model@1.0.0";

let root: string;
let store: VectorStore;

function fakeEmbed(text: string): number[] {
  const v = [0, 0, 0];
  for (const ch of text) v[ch.charCodeAt(0) % 3]! += 1;
  return v;
}

/** Un chunk par ligne : un fichier de trois lignes coûte trois embeddings. */
function chunkPerLine(path: string, content: string): Chunk[] {
  return content.split("\n").map((text, i) => ({ chunkId: `${path}#${i}`, sourcePath: path, text }));
}

function stopAfterCalls(embed: { mock: { calls: unknown[] } }, n: number): () => boolean {
  return () => embed.mock.calls.length >= n;
}

function indexedChunkIds(): string[] {
  return store
    .search([1, 1, 1], 100)
    .map((r) => r.path)
    .sort();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-rag-ceiling-"));
  store = new VectorStore(join(root, "index.sqlite"));
});

afterEach(() => {
  store.close();
  rmTree(root);
});

describe("rebuildIfStale, plafond de durée", () => {
  it("dit qu'il a fini quand rien ne l'arrête", async () => {
    const outcome = await rebuildIfStale(store, [{ path: "a.md", content: "aaa" }], fakeEmbed, IDENTITY);

    expect(outcome).toEqual({ completed: true, filesEmbedded: 1 });
  });

  it("s'arrête au plafond, garde les fichiers finis, et ne déclare pas l'index à jour", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [
      { path: "a.md", content: "aaa" },
      { path: "b.md", content: "bbb" },
      { path: "c.md", content: "ccc" },
    ];

    const outcome = await rebuildIfStale(store, corpus, embed, IDENTITY, chunkPerLine, stopAfterCalls(embed, 1));

    expect(outcome).toEqual({ completed: false, filesEmbedded: 1 });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(Object.keys(store.getFileHashes())).toEqual(["a.md"]);
    expect(store.getFingerprint()).toBeNull();
  });

  it("laisse intact l'index d'un fichier interrompu en cours de route", async () => {
    const before = [{ path: "gros.md", content: "un\ndeux\ntrois" }];
    await rebuildIfStale(store, before, fakeEmbed, IDENTITY, chunkPerLine);
    const hashesBefore = store.getFileHashes();
    const fingerprintBefore = store.getFingerprint();
    const embed = vi.fn(fakeEmbed);
    const edited = [{ path: "gros.md", content: "UN\nDEUX\nTROIS\nQUATRE" }];

    const outcome = await rebuildIfStale(store, edited, embed, IDENTITY, chunkPerLine, stopAfterCalls(embed, 2));

    expect(outcome).toEqual({ completed: false, filesEmbedded: 0 });
    expect(indexedChunkIds()).toEqual(["gros.md#0", "gros.md#1", "gros.md#2"]);
    expect(store.search(fakeEmbed("un"), 1)[0]?.score).toBeCloseTo(1);
    expect(store.getFileHashes()).toEqual(hashesBefore);
    expect(store.getFingerprint()).toBe(fingerprintBefore);
  });

  it("le lancement suivant finit ce que le plafond a coupé", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [
      { path: "a.md", content: "aaa" },
      { path: "b.md", content: "bbb" },
    ];
    await rebuildIfStale(store, corpus, embed, IDENTITY, chunkPerLine, stopAfterCalls(embed, 1));

    const outcome = await rebuildIfStale(store, corpus, embed, IDENTITY, chunkPerLine);

    expect(outcome).toEqual({ completed: true, filesEmbedded: 1 });
    expect(Object.keys(store.getFileHashes()).sort()).toEqual(["a.md", "b.md"]);
    expect(store.getFingerprint()).not.toBeNull();
  });

  it("remplace les chunks d'un fichier raccourci sans laisser les anciens", async () => {
    await rebuildIfStale(store, [{ path: "gros.md", content: "un\ndeux\ntrois" }], fakeEmbed, IDENTITY, chunkPerLine);

    await rebuildIfStale(store, [{ path: "gros.md", content: "seul" }], fakeEmbed, IDENTITY, chunkPerLine);

    expect(indexedChunkIds()).toEqual(["gros.md#0"]);
  });
});

describe("stopAfter", () => {
  it("ne demande pas l'arrêt avant le plafond, le demande une fois le plafond atteint", () => {
    let now = 1_000;
    const shouldStop = stopAfter(300, () => now);

    expect(shouldStop()).toBe(false);
    now = 1_299;
    expect(shouldStop()).toBe(false);
    now = 1_300;
    expect(shouldStop()).toBe(true);
  });
});
