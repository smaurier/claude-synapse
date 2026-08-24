/**
 * The one real wiring point between search.ts (generic, model-agnostic, kept
 * fast to test) and the actual local embedding model (embeddingProvider.ts).
 *
 * search.ts injects both `embed` and `chunkFn` with a default chunker
 * (chunk.ts's character-count heuristic) so its own unit tests stay fast and
 * don't need to load a real model. That default is deliberately WRONG for
 * production: it's the same unreliable chars-per-token estimate that got
 * replaced by tokenChunk.ts in the first place (see chunk.ts's doc comment).
 * Any real caller that calls brainSearch()/rebuildIfStale() directly and
 * forgets to pass chunkFileForEmbedding would silently fall back to it.
 *
 * This module removes that possibility rather than relying on callers to
 * remember: the functions below don't expose an embed or chunkFn parameter
 * at all, so there is nothing to forget. Every real caller (the future
 * `/brain-search` command, SessionStart refresh) should go through here, not
 * through search.ts directly.
 */
import { rebuildIfStale, brainSearch } from "./search.js";
import { chunkFileForEmbedding, embedLocal } from "./embeddingProvider.js";
export async function rebuildIndexIfStale(store, corpus) {
    await rebuildIfStale(store, corpus, embedLocal, chunkFileForEmbedding);
}
export async function synapseSearch(store, corpus, query, topK = 10) {
    return brainSearch(store, corpus, embedLocal, query, topK, chunkFileForEmbedding);
}
//# sourceMappingURL=production.js.map