import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VectorStore } from "../src/rag/store.js";
import { synapseSearch } from "../src/rag/production.js";

// Real model, real tokenizer, real chunker — the actual proof that the
// production wiring point (not just its pieces in isolation) behaves.
// Slow (model load + WASM inference), kept in its own file for that reason,
// same rationale as rag-embeddingProvider.integration.test.ts.

let root: string;
let store: VectorStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-rag-production-"));
  store = new VectorStore(join(root, "index.sqlite"));
});

afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe("synapseSearch", () => {
  it("finds the most relevant file using the real embedding model", async () => {
    const corpus = [
      { path: "chat.md", content: "Le chat dort sur le canapé toute la journée." },
      { path: "voiture.md", content: "La voiture roule vite sur l'autoroute." },
    ];

    const results = await synapseSearch(store, corpus, "un félin qui fait la sieste", 1);

    expect(results[0]?.path).toBe("chat.md");
  }, 30_000);

  it("indexes a file long enough to require chunking without losing it from search", async () => {
    const longContent = "Décision du 22/07/2026 sur le projet Synapse et son architecture. ".repeat(30);
    const corpus = [
      { path: "long.md", content: longContent },
      { path: "autre.md", content: "Recette de cuisine : faire bouillir des pâtes." },
    ];

    const results = await synapseSearch(store, corpus, "architecture du projet Synapse", 1);

    expect(results[0]?.path).toBe("long.md");
  }, 30_000);
});
