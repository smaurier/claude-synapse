// Empirical test of the "a memory corpus is small enough that a specialized
// vector index buys nothing" assumption (problème 4, store.ts's own doc
// comment) — flagged 14/08 as never actually validated beyond a few hundred
// files, and published without being tested. Measures real code (dist/),
// not a reimplementation. Uses a fast synthetic embed (deterministic,
// hash-based) on purpose: isolates the ALGORITHMIC scaling of search and
// merge-candidate detection from real-model embedding latency, which is a
// separate, already-accepted cost unrelated to this specific question.
//
// Usage: node scripts/scale-test.mjs
import { VectorStore } from "../dist/rag/store.js";
import { chunkFile } from "../dist/rag/chunk.js";
import { findMergeCandidates } from "../dist/commands/brainLint.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Deterministic 384-dim pseudo-vector from a string — fast (no model call),
// stable per input, spread out enough that cosine similarity behaves
// realistically (not everything scoring near-identical or near-zero).
function fakeEmbed(text) {
  const v = new Array(384).fill(0);
  for (let i = 0; i < text.length; i++) {
    v[(text.charCodeAt(i) * (i + 1)) % 384] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

function syntheticCorpus(n) {
  const files = [];
  for (let i = 0; i < n; i++) {
    // Varied-length content, some short (single chunk), some long enough to
    // need chunking (chunkFile's default 500-char window) — mirrors a real
    // mixed corpus rather than N identical tiny files.
    const paragraphs = 1 + (i % 5);
    const content = Array.from({ length: paragraphs }, (_, p) => `Paragraphe ${p} du fichier ${i} — contenu synthétique de test à l'échelle, répété pour atteindre une longueur réaliste. `.repeat(3)).join("\n\n");
    files.push({ path: `synthetic-${i}.md`, content });
  }
  return files;
}

async function measure(n) {
  const corpus = syntheticCorpus(n);
  const dir = mkdtempSync(join(tmpdir(), "synapse-scale-"));
  const store = new VectorStore(join(dir, "index.sqlite"));
  try {
    const t0 = performance.now();
    for (const f of corpus) {
      for (const chunk of chunkFile(f.path, f.content)) {
        store.upsert(chunk.chunkId, fakeEmbed(chunk.text));
      }
    }
    const indexMs = performance.now() - t0;

    const t1 = performance.now();
    store.search(fakeEmbed("requête de test"), 10);
    const searchMs = performance.now() - t1;

    const t2 = performance.now();
    const candidates = await findMergeCandidates(corpus, fakeEmbed, chunkFile);
    const mergeMs = performance.now() - t2;

    console.log(`n=${n}\tindex=${indexMs.toFixed(0)}ms\tsearch=${searchMs.toFixed(1)}ms\tfindMergeCandidates=${mergeMs.toFixed(0)}ms (${candidates.length} candidats)`);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const n of [100, 500, 1000, 2000, 4000]) {
  await measure(n);
}
