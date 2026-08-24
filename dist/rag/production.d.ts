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
import type { CorpusFile } from "./hash.js";
import type { SearchResult, VectorStore } from "./store.js";
export declare function rebuildIndexIfStale(store: VectorStore, corpus: CorpusFile[]): Promise<void>;
export declare function synapseSearch(store: VectorStore, corpus: CorpusFile[], query: string, topK?: number): Promise<SearchResult[]>;
