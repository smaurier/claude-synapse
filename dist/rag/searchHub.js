/**
 * Chains a hub directory on disk straight to search results — the core of
 * the real CLI entrypoint (bin/brain-search), everything except resolving
 * where LocalConfig itself lives on disk (deferred to packaging: that's a
 * separate, still-undecided question, not something to invent here).
 *
 * The index db lives at <hub>/.synapse/index.sqlite — inside the hub but
 * already excluded from both git (.gitignore) and the corpus walk
 * (corpus.ts's SKIP_DIRS), so it never gets synced or re-indexed as if it
 * were a memory file.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadHubCorpus } from "./corpus.js";
import { ensurePinnedEmbeddingModel, getEmbedderIdentity } from "./embedderIdentity.js";
import { VectorStore } from "./store.js";
import { isIndexCurrent } from "./search.js";
// production.js pulls in @huggingface/transformers (0.75 to 1 s to import,
// measured 17/11/2026). Loaded on demand so that a refresh which finds the
// corpus unchanged never pays for it.
const loadEmbeddingPipeline = () => import("./production.js");
function openHubStore(hubClonePath) {
    const dbDir = join(hubClonePath, ".synapse");
    mkdirSync(dbDir, { recursive: true });
    return new VectorStore(join(dbDir, "index.sqlite"));
}
/** Only the refresh hook calls this, under the refresh lock: one process of
 *  the workstation rewrites the file, never a search in the middle of one. */
export function compactHubIndex(hubClonePath) {
    const store = openHubStore(hubClonePath);
    try {
        return store.compactIfMostlyFree();
    }
    finally {
        store.close();
    }
}
export async function searchHub(hubClonePath, query, topK = 10, options = {}) {
    const refreshIndex = options.refreshIndex ?? true;
    ensurePinnedEmbeddingModel(hubClonePath);
    const store = openHubStore(hubClonePath);
    try {
        const corpus = loadHubCorpus(hubClonePath);
        const { synapseSearch, synapseSearchReadOnly } = await loadEmbeddingPipeline();
        return refreshIndex
            ? await synapseSearch(store, corpus, query, topK)
            : await synapseSearchReadOnly(store, corpus, query, topK);
    }
    finally {
        store.close();
    }
}
/** Rebuilds the hub's index if the corpus changed since last time, without
 *  running a search — what the SessionStart refresh hook calls. Same store
 *  location and staleness rule as searchHub(), just without a query. */
export async function refreshHubIndex(hubClonePath, options = {}) {
    ensurePinnedEmbeddingModel(hubClonePath);
    const store = openHubStore(hubClonePath);
    try {
        const corpus = loadHubCorpus(hubClonePath);
        if (isIndexCurrent(store, corpus, getEmbedderIdentity()))
            return { completed: true, filesEmbedded: 0 };
        await options.beforeEmbedding?.();
        const { rebuildIndexIfStale } = await loadEmbeddingPipeline();
        return await rebuildIndexIfStale(store, corpus, options.shouldStop);
    }
    finally {
        store.close();
    }
}
//# sourceMappingURL=searchHub.js.map