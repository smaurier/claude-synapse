import { it, expect } from "vitest";
import { getEmbedderIdentity, DEFAULT_MODEL_ID } from "../src/rag/embeddingProvider.js";

// backlog #50 (16/10/2026): fast, no model load — reading the installed
// @huggingface/transformers version straight from its own package.json is
// synchronous I/O, unlike chunkFileForEmbedding/embedLocal which need the
// real WASM model (see rag-embeddingProvider.integration.test.ts for those).

it("combines the pinned model id with the installed library version", () => {
  const identity = getEmbedderIdentity();

  // Real node_modules on this machine, so the read must succeed — null
  // (the "unverifiable" case; see embeddingProvider.ts and
  // rag-search.test.ts's abstention test) is exercised separately and is
  // not expected here.
  expect(identity).not.toBeNull();
  expect(identity!.startsWith(`${DEFAULT_MODEL_ID}@`)).toBe(true);
  // The installed @huggingface/transformers is a real, published semver
  // (package.json pins "4.3.1" as of this writing) — asserting the shape
  // rather than the exact version keeps this test from rotting on the next
  // routine dependency bump.
  const version = identity!.slice(`${DEFAULT_MODEL_ID}@`.length);
  expect(version).toMatch(/^\d+\.\d+\.\d+/);
});
