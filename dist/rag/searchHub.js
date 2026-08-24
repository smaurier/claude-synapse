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
import { synapseSearch, rebuildIndexIfStale } from "./production.js";
import { ensurePinnedEmbeddingModel } from "./embeddingProvider.js";
import { VectorStore } from "./store.js";
function openHubStore(hubClonePath) {
    const dbDir = join(hubClonePath, ".synapse");
    mkdirSync(dbDir, { recursive: true });
    return new VectorStore(join(dbDir, "index.sqlite"));
}
export async function searchHub(hubClonePath, query, topK = 10) {
    ensurePinnedEmbeddingModel(hubClonePath);
    const store = openHubStore(hubClonePath);
    try {
        const corpus = loadHubCorpus(hubClonePath);
        return await synapseSearch(store, corpus, query, topK);
    }
    finally {
        store.close();
    }
}
/** Rebuilds the hub's index if the corpus changed since last time, without
 *  running a search — what the SessionStart refresh hook calls. Same store
 *  location and staleness rule as searchHub(), just without a query. */
export async function refreshHubIndex(hubClonePath) {
    ensurePinnedEmbeddingModel(hubClonePath);
    const store = openHubStore(hubClonePath);
    try {
        const corpus = loadHubCorpus(hubClonePath);
        await rebuildIndexIfStale(store, corpus);
    }
    finally {
        store.close();
    }
}
//# sourceMappingURL=searchHub.js.map