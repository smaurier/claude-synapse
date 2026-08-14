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
