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
export function stopAfter(maxMs, now = Date.now) {
    const deadline = now() + maxMs;
    return () => now() >= deadline;
}
const neverStop = () => false;
/** How many freshly embedded chunks may be lost to a hard kill. At 58 ms per
 *  chunk (measured 17/11/2026) a batch is about two seconds of work, and one
 *  transaction instead of thirty-two. */
const PROGRESS_BATCH_SIZE = 32;
/** The question rebuildIfStale asks first, answerable without an embedder:
 *  callers use it to skip loading one at all. Same abstention on an
 *  unverifiable (`null`) identity as rebuildIfStale itself. */
export function isIndexCurrent(store, corpus, embedderIdentity) {
    if (embedderIdentity !== null && store.getEmbedderIdentity() !== embedderIdentity)
        return false;
    return store.getFingerprint() === computeCorpusFingerprint(corpus);
}
export async function rebuildIfStale(store, corpus, embed, embedderIdentity, chunkFn = chunkFile, shouldStop = neverStop) {
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
        return { completed: true, filesEmbedded: 0 };
    const previousHashes = store.getFileHashes();
    const currentPaths = new Set(corpus.map((f) => f.path));
    for (const path of Object.keys(previousHashes)) {
        if (!currentPaths.has(path)) {
            store.deleteChunksForSourcePath(path);
            store.deleteFileHash(path);
        }
    }
    let filesEmbedded = 0;
    for (const file of corpus) {
        const newHash = hashFileContent(file.content);
        if (previousHashes[file.path] === newHash)
            continue; // unchanged — skip entirely
        if (shouldStop())
            return { completed: false, filesEmbedded };
        const alreadyEmbedded = store.resumePendingChunks(file.path, newHash);
        const embedded = [];
        let unsaved = [];
        const saveProgress = () => {
            store.savePendingChunks(file.path, newHash, unsaved);
            unsaved = [];
        };
        for (const chunk of await chunkFn(file.path, file.content)) {
            const resumed = alreadyEmbedded.get(chunk.chunkId);
            if (resumed !== undefined) {
                embedded.push({ chunkId: chunk.chunkId, embedding: resumed });
                continue;
            }
            if (shouldStop()) {
                saveProgress();
                return { completed: false, filesEmbedded };
            }
            const fresh = { chunkId: chunk.chunkId, embedding: await embed(chunk.text) };
            embedded.push(fresh);
            unsaved.push(fresh);
            if (unsaved.length >= PROGRESS_BATCH_SIZE)
                saveProgress();
        }
        store.replaceFileChunks(file.path, embedded, newHash);
        filesEmbedded += 1;
    }
    store.setFingerprint(fingerprint);
    store.discardPendingChunks();
    return { completed: true, filesEmbedded };
}
/** Searches at chunk granularity, then collapses back to one result per
 *  source file (keeping each file's best-scoring chunk) — callers care
 *  about "which memory file is relevant", not which internal slice of it
 *  happened to match best. */
/** Interroge l'index TEL QU'IL EST, sans jamais le reconstruire — backlog
 *  51 (16/10/2026). Le hook UserPromptSubmit a un budget de 15 s ; un
 *  fichier de 274 Ko prenait 44 s à ré-embedder, le hook se faisait tuer
 *  avant d'avoir stampé le hash du fichier, et repartait de zéro au prompt
 *  suivant — timeout à CHAQUE prompt, rappel jamais livré. La
 *  reconstruction appartient au SessionStart (120 s) et au hook Stop
 *  asynchrone ; ici, un index légèrement périmé est le prix accepté.
 *
 *  Deux garde-fous que rebuildIfStale rendait inutiles et que la lecture
 *  seule doit donc porter elle-même : un fichier disparu du corpus peut
 *  encore avoir des chunks dans l'index (filtré), et un index construit par
 *  un autre embedder n'est pas comparable à la requête (on s'abstient —
 *  même règle du `null` que rebuildIfStale : invérifiable ≠ différent). */
export async function searchIndex(store, corpus, embed, embedderIdentity, query, topK = 10) {
    if (embedderIdentity !== null && store.getEmbedderIdentity() !== embedderIdentity)
        return [];
    const currentPaths = new Set(corpus.map((f) => f.path));
    // Over-fetch at chunk granularity so that after collapsing to one result
    // per file, we still have up to topK distinct files to return.
    const chunkResults = store.search(await embed(query), topK * 5);
    const bestPerFile = new Map();
    for (const r of chunkResults) {
        const path = sourcePathFromChunkId(r.path);
        if (!currentPaths.has(path))
            continue;
        const existing = bestPerFile.get(path);
        if (existing === undefined || r.score > existing.score)
            bestPerFile.set(path, { score: r.score, chunkId: r.path });
    }
    return [...bestPerFile.entries()]
        .map(([path, { score, chunkId }]) => ({ path, score, chunkId }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}
export async function brainSearch(store, corpus, embed, embedderIdentity, query, topK = 10, chunkFn = chunkFile) {
    await rebuildIfStale(store, corpus, embed, embedderIdentity, chunkFn);
    return searchIndex(store, corpus, embed, embedderIdentity, query, topK);
}
//# sourceMappingURL=search.js.map