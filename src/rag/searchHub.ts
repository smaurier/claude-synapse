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
import { loadCorpus } from "./corpus.js";
import { synapseSearch } from "./production.js";
import { VectorStore, type SearchResult } from "./store.js";

export async function searchHub(hubClonePath: string, query: string, topK = 10): Promise<SearchResult[]> {
  const dbDir = join(hubClonePath, ".synapse");
  mkdirSync(dbDir, { recursive: true });

  const store = new VectorStore(join(dbDir, "index.sqlite"));
  try {
    const corpus = loadCorpus(hubClonePath);
    return await synapseSearch(store, corpus, query, topK);
  } finally {
    store.close();
  }
}
