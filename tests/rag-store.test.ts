import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VectorStore } from "../src/rag/store.js";

let root: string;
let dbPath: string;
let store: VectorStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-rag-"));
  dbPath = join(root, "index.sqlite");
  store = new VectorStore(dbPath);
});

afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe("VectorStore", () => {
  it("returns no results when empty", () => {
    expect(store.search([1, 0, 0], 5)).toEqual([]);
  });

  it("ranks results by cosine similarity, closest first", () => {
    store.upsert("a.md", [1, 0, 0]);
    store.upsert("b.md", [0, 1, 0]);
    store.upsert("c.md", [0.9, 0.1, 0]); // close to a.md

    const results = store.search([1, 0, 0], 3);

    expect(results.map((r) => r.path)).toEqual(["a.md", "c.md", "b.md"]);
  });

  it("respects topK", () => {
    store.upsert("a.md", [1, 0, 0]);
    store.upsert("b.md", [0, 1, 0]);
    store.upsert("c.md", [0, 0, 1]);
    expect(store.search([1, 0, 0], 1)).toHaveLength(1);
  });

  it("upsert replaces an existing entry for the same path rather than duplicating it", () => {
    store.upsert("a.md", [1, 0, 0]);
    store.upsert("a.md", [0, 1, 0]); // same path, new embedding
    const results = store.search([0, 1, 0], 10);
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe("a.md");
  });

  it("clear empties the store", () => {
    store.upsert("a.md", [1, 0, 0]);
    store.clear();
    expect(store.search([1, 0, 0], 5)).toEqual([]);
  });

  // Ajoute 14/08 (revue de code) : clear() oubliait de reinitialiser le
  // fingerprint, ce qui aurait fait sauter silencieusement une reconstruction
  // d'index sur un corpus inchange apres un clear().
  it("clear() also resets the fingerprint back to null", () => {
    store.setFingerprint("abc123");
    store.clear();
    expect(store.getFingerprint()).toBeNull();
  });

  it("persists a fingerprint alongside the vectors, defaulting to null", () => {
    expect(store.getFingerprint()).toBeNull();
    store.setFingerprint("abc123");
    expect(store.getFingerprint()).toBe("abc123");
  });

  it("survives being reopened from the same file (data actually persists to disk)", () => {
    store.upsert("a.md", [1, 0, 0]);
    store.setFingerprint("xyz");
    store.close();

    const reopened = new VectorStore(dbPath);
    expect(reopened.getFingerprint()).toBe("xyz");
    expect(reopened.search([1, 0, 0], 1)).toHaveLength(1);
    reopened.close();
  });
});

describe("VectorStore — incremental rebuild support", () => {
  it("deleteChunksForSourcePath removes the bare-path row and every #N chunk of that file", () => {
    store.upsert("big.md", [1, 0, 0]);
    store.upsert("big.md#0", [1, 0, 0]);
    store.upsert("big.md#1", [1, 0, 0]);
    store.upsert("other.md", [0, 1, 0]); // must survive — different source file

    store.deleteChunksForSourcePath("big.md");

    const results = store.search([1, 0, 0], 10);
    expect(results.map((r) => r.path)).toEqual(["other.md"]);
  });

  it("tracks and retrieves per-file content hashes", () => {
    expect(store.getFileHashes()).toEqual({});
    store.setFileHash("a.md", "hash-a");
    store.setFileHash("b.md", "hash-b");
    expect(store.getFileHashes()).toEqual({ "a.md": "hash-a", "b.md": "hash-b" });
  });

  it("setFileHash overwrites an existing hash for the same path", () => {
    store.setFileHash("a.md", "old");
    store.setFileHash("a.md", "new");
    expect(store.getFileHashes()).toEqual({ "a.md": "new" });
  });

  it("deleteFileHash removes only the given path's hash", () => {
    store.setFileHash("a.md", "hash-a");
    store.setFileHash("b.md", "hash-b");
    store.deleteFileHash("a.md");
    expect(store.getFileHashes()).toEqual({ "b.md": "hash-b" });
  });

  it("clear() also wipes file hashes, not just vectors", () => {
    store.setFileHash("a.md", "hash-a");
    store.clear();
    expect(store.getFileHashes()).toEqual({});
  });
});
