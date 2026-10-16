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
 *  Unchanged files are never re-chunked or re-embedded.
 *
 *  `embedderIdentity` is required, not optional-with-a-default — backlog
 *  #50 (16/10/2026): pinning the MODEL id (ensurePinnedEmbeddingModel) was
 *  never the full story, because nothing pinned the @huggingface/
 *  transformers LIBRARY version that actually produces the vectors. A
 *  default that silently skipped the check would be a guard that rots the
 *  first time someone forgets to pass it; every real caller (production.ts)
 *  passes the real identity, tests pass an explicit fake one.
 *
 *  It is typed `string | null` on purpose, not just `string`: `null` means
 *  "the caller could not verify the identity this run" (see
 *  embeddingProvider.ts's getEmbedderIdentity — an unreadable package.json,
 *  not an absence of pinning). Found during review 16/10/2026: a machine
 *  where that read fails INTERMITTENTLY (partially restored node_modules,
 *  a permissions hiccup, an antivirus holding the file) would otherwise see
 *  the identity flip between a real version and a placeholder on every
 *  run, and EACH flip would clear the store and re-embed the whole corpus
 *  — far more expensive than the drift this guard exists to catch. A guard
 *  that cannot verify must say nothing, not guess; abstaining on `null` is
 *  not a regression, it is exactly today's behaviour (no guard at all) in
 *  a case that should be vanishingly rare. */
export async function rebuildIfStale(store, corpus, embed, embedderIdentity, chunkFn = chunkFile) {
    // MUST run before the fingerprint early-return below, not after. Folding
    // the identity into computeCorpusFingerprint() instead was the design
    // first considered and rejected (16/10/2026): if the corpus is
    // byte-identical to last time, salting only the whole-corpus fingerprint
    // still leaves every PER-FILE hash matching below, so the loop would skip
    // every file, embed nothing, and then stamp the index fresh anyway — a
    // silent degradation that also claims to be up to date. Clearing the
    // store here instead forces every file through the per-file loop
    // regardless of what the fingerprint says.
    //
    // `embedderIdentity !== null` guards the whole thing: a KNOWN identity
    // differing from a KNOWN (or absent) stored one still forces exactly one
    // rebuild, but an UNVERIFIABLE identity (null) leaves the store — vectors,
    // hashes, recorded identity — completely untouched (see the doc comment
    // above for why).
    if (embedderIdentity !== null && store.getEmbedderIdentity() !== embedderIdentity) {
        store.clear(); // wipes vectors + file hashes + fingerprint (see store.ts)
        store.setEmbedderIdentity(embedderIdentity);
    }
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
export async function brainSearch(store, corpus, embed, embedderIdentity, query, topK = 10, chunkFn = chunkFile) {
    await rebuildIfStale(store, corpus, embed, embedderIdentity, chunkFn);
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