/**
 * Orchestrates the "reconstruction paresseuse au premier /brain-search,
 * rafraîchie à chaque SessionStart si les fichiers ont changé" rule
 * (problème 4, 13/08). The embedding function is injected on purpose: this
 * module must stay testable without depending on which local embedding
 * model ends up wired in.
 *
 * The chunking function is injected too (defaulting to the character-based
 * heuristic in chunk.ts) so the real pipeline can swap in
 * tokenChunk.chunkFileByTokens — the exact, tokenizer-backed method the user
 * asked for on 13/08 after a character-ratio estimate ("faut-il envisager
 * autre chose ?") turned out to be unreliable across languages/content.
 *
 * Incremental since 14/08 — was "full rebuild, not incremental (corpus is
 * small enough that incremental diffing buys nothing but drift risk)".
 * That assumption held at design time; the real-hub test the same day
 * measured otherwise (121 files, a full rebuild on every single edit felt
 * "très long" in practice). Per-file content hashes (hash.ts) now decide
 * which files actually need re-chunking/re-embedding — unchanged files are
 * skipped entirely, not just the whole-corpus fast path.
 */

import { chunkFile, sourcePathFromChunkId, type Chunk } from "./chunk.js";
import { computeCorpusFingerprint, hashFileContent, type CorpusFile } from "./hash.js";
import type { SearchResult, VectorStore } from "./store.js";

// Async because a real local model (see embeddingProvider.ts) can't embed
// synchronously — a plain array return still satisfies this signature, so
// the existing synchronous fakes in tests need no changes beyond awaiting.
export type EmbeddingProvider = (text: string) => number[] | Promise<number[]>;
export type ChunkFn = (path: string, content: string) => Chunk[] | Promise<Chunk[]>;

/** Rebuilds only what changed since the last build. The whole-corpus
 *  fingerprint is still the fast first check (nothing changed at all ->
 *  skip everything, no per-file diffing needed); once that says something
 *  did change, per-file hashes narrow the actual work to added/modified
 *  files, and remove chunks for files that disappeared from the corpus.
 *  Unchanged files are never re-chunked or re-embedded. */
export async function rebuildIfStale(
  store: VectorStore,
  corpus: CorpusFile[],
  embed: EmbeddingProvider,
  chunkFn: ChunkFn = chunkFile,
): Promise<void> {
  const fingerprint = computeCorpusFingerprint(corpus);
  if (store.getFingerprint() === fingerprint) return;

  const previousHashes = store.getFileHashes();
  const currentPaths = new Set(corpus.map((f) => f.path));

  // Files removed from the corpus since the last build: drop their chunks.
  for (const path of Object.keys(previousHashes)) {
    if (!currentPaths.has(path)) {
      store.deleteChunksForSourcePath(path);
      store.deleteFileHash(path);
    }
  }

  // Files added or changed: re-chunk and re-embed only those.
  for (const file of corpus) {
    const newHash = hashFileContent(file.content);
    if (previousHashes[file.path] === newHash) continue; // unchanged — skip entirely

    store.deleteChunksForSourcePath(file.path); // clear stale chunks if this file existed before
    for (const chunk of await chunkFn(file.path, file.content)) {
      store.upsert(chunk.chunkId, await embed(chunk.text));
    }
    store.setFileHash(file.path, newHash);
  }

  store.setFingerprint(fingerprint);
}

/** Searches at chunk granularity, then collapses back to one result per
 *  source file (keeping each file's best-scoring chunk) — callers care
 *  about "which memory file is relevant", not which internal slice of it
 *  happened to match best. */
export async function brainSearch(
  store: VectorStore,
  corpus: CorpusFile[],
  embed: EmbeddingProvider,
  query: string,
  topK = 10,
  chunkFn: ChunkFn = chunkFile,
): Promise<SearchResult[]> {
  await rebuildIfStale(store, corpus, embed, chunkFn);

  // Over-fetch at chunk granularity so that after collapsing to one result
  // per file, we still have up to topK distinct files to return.
  const chunkResults = store.search(await embed(query), topK * 5);

  const bestPerFile = new Map<string, number>();
  for (const r of chunkResults) {
    const path = sourcePathFromChunkId(r.path);
    const existing = bestPerFile.get(path);
    if (existing === undefined || r.score > existing) bestPerFile.set(path, r.score);
  }

  return [...bestPerFile.entries()]
    .map(([path, score]) => ({ path, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
