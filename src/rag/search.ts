/**
 * Orchestrates the "reconstruction paresseuse au premier /brain-search,
 * rafraîchie à chaque SessionStart si les fichiers ont changé" rule
 * (problème 4, 13/08). The embedding function is injected on purpose: this
 * module must stay testable without depending on which local embedding
 * model ends up wired in — that choice is tracked separately (see
 * project memory: "à valider concrètement... taille du modèle").
 */

import { computeCorpusFingerprint, type CorpusFile } from "./hash.js";
import type { SearchResult, VectorStore } from "./store.js";

export type EmbeddingProvider = (text: string) => number[];

/** Rebuilds the whole index only if the corpus fingerprint changed since the
 *  last build — full rebuild, not incremental (deliberate simplicity, see
 *  problème 4: corpus is small enough that incremental diffing buys nothing
 *  but drift risk). */
export function rebuildIfStale(store: VectorStore, corpus: CorpusFile[], embed: EmbeddingProvider): void {
  const fingerprint = computeCorpusFingerprint(corpus);
  if (store.getFingerprint() === fingerprint) return;

  store.clear();
  for (const file of corpus) {
    store.upsert(file.path, embed(file.content));
  }
  store.setFingerprint(fingerprint);
}

export function brainSearch(
  store: VectorStore,
  corpus: CorpusFile[],
  embed: EmbeddingProvider,
  query: string,
  topK = 10,
): SearchResult[] {
  rebuildIfStale(store, corpus, embed);
  return store.search(embed(query), topK);
}
