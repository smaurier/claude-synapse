import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VectorStore } from "../src/rag/store.js";
import { brainSearch, rebuildIfStale } from "../src/rag/search.js";
import { rmTree } from "./helpers/fsTemp.js";

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

// backlog #50 (16/10/2026): rebuildIfStale/brainSearch now require a real
// embedder identity (model id + installed @huggingface/transformers
// version — see embeddingProvider.ts's getEmbedderIdentity). Tests pass an
// explicit fake rather than relying on a default, so a test that means
// "the identity didn't change" says so, and one that means "it changed"
// says that too — see the "embedder identity" describe block below.
const FAKE_IDENTITY = "fake-model@1.0.0";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-rag-search-"));
  dbPath = join(root, "index.sqlite");
  store = new VectorStore(dbPath);
});

afterEach(() => {
  store.close();
  rmTree(root);
});

describe("rebuildIfStale", () => {
  it("builds the index on first run (empty store, no fingerprint yet)", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [{ path: "a.md", content: "aaa" }];

    await rebuildIfStale(store, corpus, embed, FAKE_IDENTITY);

    expect(embed).toHaveBeenCalledTimes(1);
    expect(store.getFingerprint()).not.toBeNull();
  });

  it("skips rebuilding when the corpus hasn't changed since last time", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [{ path: "a.md", content: "aaa" }];

    await rebuildIfStale(store, corpus, embed, FAKE_IDENTITY);
    embed.mockClear();
    await rebuildIfStale(store, corpus, embed, FAKE_IDENTITY);

    expect(embed).not.toHaveBeenCalled();
  });

  it("rebuilds when a file's content changed since last time", async () => {
    const embed = vi.fn(fakeEmbed);
    await rebuildIfStale(store, [{ path: "a.md", content: "aaa" }], embed, FAKE_IDENTITY);
    embed.mockClear();
    await rebuildIfStale(store, [{ path: "a.md", content: "changed" }], embed, FAKE_IDENTITY);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it("incremental: only re-embeds the file that changed, leaves unchanged files alone", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [
      { path: "a.md", content: "aaa" },
      { path: "b.md", content: "bbb" },
      { path: "c.md", content: "ccc" },
    ];
    await rebuildIfStale(store, corpus, embed, FAKE_IDENTITY);
    embed.mockClear();

    const updated = [
      { path: "a.md", content: "aaa" }, // unchanged
      { path: "b.md", content: "modifié" }, // changed
      { path: "c.md", content: "ccc" }, // unchanged
    ];
    await rebuildIfStale(store, updated, embed, FAKE_IDENTITY);

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith("modifié");
  });

  it("incremental: removes chunks for a file deleted from the corpus, without touching others", async () => {
    const embed = vi.fn(fakeEmbed);
    await rebuildIfStale(store, [{ path: "a.md", content: "aaa" }, { path: "b.md", content: "bbb" }], embed, FAKE_IDENTITY);
    embed.mockClear();

    await rebuildIfStale(store, [{ path: "a.md", content: "aaa" }], embed, FAKE_IDENTITY); // b.md removed

    expect(embed).not.toHaveBeenCalled(); // a.md unchanged, nothing to re-embed
    const results = store.search([0, 0, 0], 10);
    expect(results.some((r) => r.path === "b.md")).toBe(false);
  });

  it("incremental: adding a new file only embeds the new one", async () => {
    const embed = vi.fn(fakeEmbed);
    await rebuildIfStale(store, [{ path: "a.md", content: "aaa" }], embed, FAKE_IDENTITY);
    embed.mockClear();

    await rebuildIfStale(store, [{ path: "a.md", content: "aaa" }, { path: "b.md", content: "bbb" }], embed, FAKE_IDENTITY);

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

    const results = await brainSearch(store, corpus, embed, FAKE_IDENTITY, "aaa", 1);

    expect(embed).toHaveBeenCalled(); // both corpus files + the query
    expect(results[0]?.path).toBe("a.md");
  });

  it("collapses multiple chunk hits from the same long file into a single result", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [
      { path: "big.md", content: "aaa".repeat(1000) }, // long enough to be chunked
      { path: "small.md", content: "bbb" },
    ];

    const results = await brainSearch(store, corpus, embed, FAKE_IDENTITY, "aaa", 10);

    const bigHits = results.filter((r) => r.path === "big.md");
    expect(bigHits).toHaveLength(1); // never "big.md#0", "big.md#1"... in the results
  });

  // Backlog #28 follow-up (24/08 night) — chunk-level negation scoping.
  // Callers downstream (proactiveRecall's contradiction detector) need to
  // know WHICH chunk of a long file actually matched, not just that the
  // file matched — checking a whole 140KB file for negation language is
  // what produced 9-10/10 false positives in the first real test. The
  // collapsed-to-file-level result must still carry the winning chunk's id.
  it("carries the id of the winning chunk on each collapsed result", async () => {
    const embed = vi.fn(fakeEmbed);
    // "aaa" and "zzz" land in different fakeEmbed buckets — a query for
    // "zzz" should score the zzz-heavy chunk higher than the aaa-heavy one.
    const content = "aaa".repeat(300) + "zzz".repeat(300); // >500 chars: definitely multi-chunk
    const corpus = [{ path: "big.md", content }];

    const results = await brainSearch(store, corpus, embed, FAKE_IDENTITY, "zzz", 1);

    expect(results[0]?.path).toBe("big.md");
    expect(results[0]?.chunkId).toBeDefined();
    expect(results[0]?.chunkId).toMatch(/^big\.md#\d+$/);
    // The winning chunk should be a LATER one — the zzz content sits after
    // the first ~440 chars of pure "aaa", not in chunk #0.
    const chunkIndex = Number(results[0]!.chunkId!.split("#")[1]);
    expect(chunkIndex).toBeGreaterThan(0);
  });

  it("a short (single-chunk) file's chunkId is just its own path", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [{ path: "small.md", content: "bbb" }];

    const results = await brainSearch(store, corpus, embed, FAKE_IDENTITY, "bbb", 1);

    expect(results[0]?.chunkId).toBe("small.md");
  });
});

// backlog #50 (16/10/2026): ensurePinnedEmbeddingModel pins the MODEL id and
// throws on a mismatch, but nothing pinned the @huggingface/transformers
// LIBRARY version that actually produces the vectors — a tokenizer or
// pooling change there would leave stored vectors incompatible with newly
// embedded queries with no error, no warning, just quietly worse search.
// These tests are the heart of that fix: they must fail (no re-embed, no
// rebuild) against the code BEFORE the identity check was added to
// rebuildIfStale, since the corpus below never changes — only the identity
// does, which is exactly the case the fingerprint fast-path would otherwise
// swallow (see rebuildIfStale's doc comment on why the check runs first).
describe("rebuildIfStale — embedder identity guard", () => {
  it("re-embeds everything when the stored identity differs from the current one, even though the corpus is byte-identical", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [
      { path: "a.md", content: "aaa" },
      { path: "b.md", content: "bbb" },
    ];
    await rebuildIfStale(store, corpus, embed, "model@4.2.0");
    embed.mockClear();

    await rebuildIfStale(store, corpus, embed, "model@4.3.1"); // library bumped, corpus unchanged

    expect(embed).toHaveBeenCalledTimes(2); // both files re-embedded, not skipped
  });

  it("rebuilds exactly once when no identity was ever recorded (every pre-#50 store)", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [{ path: "a.md", content: "aaa" }];
    // Simulates a store built by an older plugin version: vectors and a
    // fingerprint exist, but the embedderIdentity row was never written.
    store.upsert("a.md", [1, 0, 0]);
    store.setFileHash("a.md", "whatever-hash-from-before");
    store.setFingerprint("some-old-fingerprint");
    expect(store.getEmbedderIdentity()).toBeNull();

    await rebuildIfStale(store, corpus, embed, FAKE_IDENTITY);

    expect(embed).toHaveBeenCalledTimes(1); // the one file got re-embedded
    expect(store.getEmbedderIdentity()).toBe(FAKE_IDENTITY);

    embed.mockClear();
    await rebuildIfStale(store, corpus, embed, FAKE_IDENTITY); // immediate second call

    expect(embed).not.toHaveBeenCalled(); // identity now matches, corpus unchanged — no second rebuild
  });

  it("does NOT re-embed when the identity matches and the corpus is unchanged (no performance regression)", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [{ path: "a.md", content: "aaa" }];
    await rebuildIfStale(store, corpus, embed, FAKE_IDENTITY);
    embed.mockClear();

    await rebuildIfStale(store, corpus, embed, FAKE_IDENTITY);

    expect(embed).not.toHaveBeenCalled();
  });

  it("records the new identity after a rebuild it triggered", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [{ path: "a.md", content: "aaa" }];
    await rebuildIfStale(store, corpus, embed, "model@4.2.0");

    expect(store.getEmbedderIdentity()).toBe("model@4.2.0");
  });

  // Added after review 16/10/2026: the FIRST version of this guard compared
  // and recorded the identity string unconditionally, including the
  // "couldn't read the library version" placeholder. On a machine where
  // that read fails intermittently, the identity would flip between a real
  // version and the placeholder on every run, and EACH flip would clear and
  // re-embed the whole corpus — far more expensive than the drift this
  // guard exists to catch. `null` (see embeddingProvider.ts's
  // getEmbedderIdentity) must make rebuildIfStale abstain entirely instead.
  it("leaves a populated store untouched and re-embeds nothing when the identity is unverifiable (null), even on an unchanged corpus", async () => {
    const embed = vi.fn(fakeEmbed);
    const corpus = [{ path: "a.md", content: "aaa" }];
    await rebuildIfStale(store, corpus, embed, FAKE_IDENTITY); // normal build, known identity recorded
    embed.mockClear();

    await rebuildIfStale(store, corpus, embed, null); // this run couldn't verify the library version

    expect(embed).not.toHaveBeenCalled(); // abstained — no clear, no re-embed
    expect(store.getEmbedderIdentity()).toBe(FAKE_IDENTITY); // stored identity untouched, not overwritten with null
  });
});
