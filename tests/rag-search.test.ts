import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VectorStore } from "../src/rag/store.js";
import { brainSearch, rebuildIfStale } from "../src/rag/search.js";

let root: string;
let dbPath: string;
let store: VectorStore;

// Deterministic fake: turns a string into a fixed-length "embedding" from char
// codes, so tests can assert on ranking without a real ML model. Real local
// embedding model wiring is exercised separately (embeddingProvider.ts +
// its own integration test) against the actual model.
function fakeEmbed(text: string): number[] {
  const v = [0, 0, 0];
  for (const ch of text) v[ch.charCodeAt(0) % 3]! += 1;
  return v;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-rag-search-"));
  dbPath = join(root, "index.sqlite");
  store = new VectorStore(dbPath);
});

afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe("rebuildIfStale", () => {
  it("builds the index on first run (empty store, no fingerprint yet)", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [{ path: "a.md", content: "aaa" }];

    await rebuildIfStale(store, corpus, embed);

    expect(embed).toHaveBeenCalledTimes(1);
    expect(store.getFingerprint()).not.toBeNull();
  });

  it("skips rebuilding when the corpus hasn't changed since last time", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [{ path: "a.md", content: "aaa" }];

    await rebuildIfStale(store, corpus, embed);
    embed.mockClear();
    await rebuildIfStale(store, corpus, embed);

    expect(embed).not.toHaveBeenCalled();
  });

  it("rebuilds when a file's content changed since last time", async () => {
    const embed = vi.fn(fakeEmbed);
    await rebuildIfStale(store, [{ path: "a.md", content: "aaa" }], embed);
    embed.mockClear();
    await rebuildIfStale(store, [{ path: "a.md", content: "changed" }], embed);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it("incremental: only re-embeds the file that changed, leaves unchanged files alone", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [
      { path: "a.md", content: "aaa" },
      { path: "b.md", content: "bbb" },
      { path: "c.md", content: "ccc" },
    ];
    await rebuildIfStale(store, corpus, embed);
    embed.mockClear();

    const updated = [
      { path: "a.md", content: "aaa" }, // unchanged
      { path: "b.md", content: "modifié" }, // changed
      { path: "c.md", content: "ccc" }, // unchanged
    ];
    await rebuildIfStale(store, updated, embed);

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith("modifié");
  });

  it("incremental: removes chunks for a file deleted from the corpus, without touching others", async () => {
    const embed = vi.fn(fakeEmbed);
    await rebuildIfStale(store, [{ path: "a.md", content: "aaa" }, { path: "b.md", content: "bbb" }], embed);
    embed.mockClear();

    await rebuildIfStale(store, [{ path: "a.md", content: "aaa" }], embed); // b.md removed

    expect(embed).not.toHaveBeenCalled(); // a.md unchanged, nothing to re-embed
    const results = store.search([0, 0, 0], 10);
    expect(results.some((r) => r.path === "b.md")).toBe(false);
  });

  it("incremental: adding a new file only embeds the new one", async () => {
    const embed = vi.fn(fakeEmbed);
    await rebuildIfStale(store, [{ path: "a.md", content: "aaa" }], embed);
    embed.mockClear();

    await rebuildIfStale(store, [{ path: "a.md", content: "aaa" }, { path: "b.md", content: "bbb" }], embed);

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith("bbb");
  });
});

describe("brainSearch", () => {
  it("triggers a rebuild lazily on first search, then answers the query", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [
      { path: "a.md", content: "aaa" },
      { path: "b.md", content: "bbb" },
    ];

    const results = await brainSearch(store, corpus, embed, "aaa", 1);

    expect(embed).toHaveBeenCalled(); // both corpus files + the query
    expect(results[0]?.path).toBe("a.md");
  });

  it("collapses multiple chunk hits from the same long file into a single result", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [
      { path: "big.md", content: "aaa".repeat(1000) }, // long enough to be chunked
      { path: "small.md", content: "bbb" },
    ];

    const results = await brainSearch(store, corpus, embed, "aaa", 10);

    const bigHits = results.filter((r) => r.path === "big.md");
    expect(bigHits).toHaveLength(1); // never "big.md#0", "big.md#1"... in the results
  });
});
