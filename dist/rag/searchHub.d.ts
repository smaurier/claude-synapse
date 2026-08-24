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
import { type SearchResult } from "./store.js";
export declare function searchHub(hubClonePath: string, query: string, topK?: number): Promise<SearchResult[]>;
/** Rebuilds the hub's index if the corpus changed since last time, without
 *  running a search — what the SessionStart refresh hook calls. Same store
 *  location and staleness rule as searchHub(), just without a query. */
export declare function refreshHubIndex(hubClonePath: string): Promise<void>;
