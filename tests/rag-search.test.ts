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
// embedding model wiring is a separate, explicitly tracked follow-up.
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
  it("builds the index on first run (empty store, no fingerprint yet)", () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [{ path: "a.md", content: "aaa" }];

    rebuildIfStale(store, corpus, embed);

    expect(embed).toHaveBeenCalledTimes(1);
    expect(store.getFingerprint()).not.toBeNull();
  });

  it("skips rebuilding when the corpus hasn't changed since last time", () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [{ path: "a.md", content: "aaa" }];

    rebuildIfStale(store, corpus, embed);
    embed.mockClear();
    rebuildIfStale(store, corpus, embed);

    expect(embed).not.toHaveBeenCalled();
  });

  it("rebuilds when a file's content changed since last time", () => {
    const embed = vi.fn(fakeEmbed);
    rebuildIfStale(store, [{ path: "a.md", content: "aaa" }], embed);
    embed.mockClear();
    rebuildIfStale(store, [{ path: "a.md", content: "changed" }], embed);
    expect(embed).toHaveBeenCalledTimes(1);
  });
});

describe("brainSearch", () => {
  it("triggers a rebuild lazily on first search, then answers the query", () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [
      { path: "a.md", content: "aaa" },
      { path: "b.md", content: "bbb" },
    ];

    const results = brainSearch(store, corpus, embed, "aaa", 1);

    expect(embed).toHaveBeenCalled(); // both corpus files + the query
    expect(results[0]?.path).toBe("a.md");
  });
});
