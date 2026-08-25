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
import { chunkFile, sourcePathFromChunkId } from "./chunk.js";
import { computeCorpusFingerprint, hashFileContent } from "./hash.js";
/** Rebuilds only what changed since the last build. The whole-corpus
 *  fingerprint is still the fast first check (nothing changed at all ->
 *  skip everything, no per-file diffing needed); once that says something
 *  did change, per-file hashes narrow the actual work to added/modified
 *  files, and remove chunks for files that disappeared from the corpus.
 *  Unchanged files are never re-chunked or re-embedded. */
export async function rebuildIfStale(store, corpus, embed, chunkFn = chunkFile) {
    const fingerprint = computeCorpusFingerprint(corpus);
    if (store.getFingerprint() === fingerprint)
        return;
    const previousHashes = store.getFileHashes();
    const currentPaths = new Set(corpus.map((f) => f.path));
    for (const path of Object.keys(previousHashes)) {
        if (!currentPaths.has(path)) {
            store.deleteChunksForSourcePath(path);
            store.deleteFileHash(path);
        }
    }
    for (const file of corpus) {
        const newHash = hashFileContent(file.content);
        if (previousHashes[file.path] === newHash)
            continue; // unchanged — skip entirely
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
export async function brainSearch(store, corpus, embed, query, topK = 10, chunkFn = chunkFile) {
    await rebuildIfStale(store, corpus, embed, chunkFn);
    // Over-fetch at chunk granularity so that after collapsing to one result
    // per file, we still have up to topK distinct files to return.
    const chunkResults = store.search(await embed(query), topK * 5);
    const bestPerFile = new Map();
    for (const r of chunkResults) {
        const path = sourcePathFromChunkId(r.path);
        const existing = bestPerFile.get(path);
        if (existing === undefined || r.score > existing.score)
            bestPerFile.set(path, { score: r.score, chunkId: r.path });
    }
    return [...bestPerFile.entries()]
        .map(([path, { score, chunkId }]) => ({ path, score, chunkId }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}
//# sourceMappingURL=search.js.map