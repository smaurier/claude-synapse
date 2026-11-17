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
import { VectorStore, type SearchResult } from "./store.js";
import { isIndexCurrent, type RebuildOutcome } from "./search.js";

// production.js pulls in @huggingface/transformers (0.75 to 1 s to import,
// measured 17/11/2026). Loaded on demand so that a refresh which finds the
// corpus unchanged never pays for it.
const loadEmbeddingPipeline = (): Promise<typeof import("./production.js")> => import("./production.js");

function openHubStore(hubClonePath: string): VectorStore {
  const dbDir = join(hubClonePath, ".synapse");
  mkdirSync(dbDir, { recursive: true });
  return new VectorStore(join(dbDir, "index.sqlite"));
}

export interface SearchHubOptions {
  /** `false` : interroger l'index tel quel, sans jamais le reconstruire.
   *  Réservé aux appelants à budget de temps borné (hook UserPromptSubmit) ;
   *  la reconstruction reste au SessionStart et au hook Stop asynchrone.
   *  Backlog 51 (16/10/2026). Défaut `true` : comportement historique de
   *  /brain-search (reconstruction paresseuse si le corpus a changé). */
  refreshIndex?: boolean;
}

export async function searchHub(
  hubClonePath: string,
  query: string,
  topK = 10,
  options: SearchHubOptions = {},
): Promise<SearchResult[]> {
  const refreshIndex = options.refreshIndex ?? true;
  ensurePinnedEmbeddingModel(hubClonePath);
  const store = openHubStore(hubClonePath);
  try {
    const corpus = loadHubCorpus(hubClonePath);
    const { synapseSearch, synapseSearchReadOnly } = await loadEmbeddingPipeline();
    return refreshIndex
      ? await synapseSearch(store, corpus, query, topK)
      : await synapseSearchReadOnly(store, corpus, query, topK);
  } finally {
    store.close();
  }
}

export interface RefreshHubIndexOptions {
  /** See rebuildIfStale: cuts the rebuild short, keeps what is finished. */
  shouldStop?: () => boolean;
  /** Runs once, only when something really has to be embedded, before the
   *  embedding library is loaded: where the caller points the model cache. */
  beforeEmbedding?: () => void | Promise<void>;
}

/** Rebuilds the hub's index if the corpus changed since last time, without
 *  running a search — what the SessionStart refresh hook calls. Same store
 *  location and staleness rule as searchHub(), just without a query. */
export async function refreshHubIndex(hubClonePath: string, options: RefreshHubIndexOptions = {}): Promise<RebuildOutcome> {
  ensurePinnedEmbeddingModel(hubClonePath);
  const store = openHubStore(hubClonePath);
  try {
    const corpus = loadHubCorpus(hubClonePath);
    if (isIndexCurrent(store, corpus, getEmbedderIdentity())) return { completed: true, filesEmbedded: 0 };

    await options.beforeEmbedding?.();
    const { rebuildIndexIfStale } = await loadEmbeddingPipeline();
    return await rebuildIndexIfStale(store, corpus, options.shouldStop);
  } finally {
    store.close();
  }
}
