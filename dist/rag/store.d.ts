/**
 * Local, disposable vector index (problème 4, 13/08 — revised during
 * construction). Originally scoped as "SQLite + sqlite-vec"; built instead
 * on Node's built-in `node:sqlite` (experimental as of Node 22-24, but
 * zero third-party native dependency) with embeddings stored as plain JSON
 * and cosine similarity computed in JS at query time. A memory corpus is
 * small enough (dozens to low hundreds of files) that a specialized native
 * vector index buys nothing but install fragility across OS/arch — exactly
 * the kind of heavy infra this project avoids everywhere else.
 *
 * Never committed to the hub, never synced — this file is a derived,
 * disposable index rebuilt from the hub's markdown files, per problème 4.
 */
export interface SearchResult {
    path: string;
    score: number;
    /** Set only on brainSearch()'s collapsed-to-file-level results (never on
     *  the raw chunk-granularity results this same type is used for inside
     *  VectorStore.search()) — the id of the specific chunk that produced
     *  this file's score, so callers that need the actual matching text
     *  (not just "this file is relevant") can fetch just that chunk instead
     *  of re-scanning the whole file. See search.ts's brainSearch(). */
    chunkId?: string;
}
export declare function cosineSimilarity(a: number[], b: number[]): number;
export interface VectorStoreOptions {
    /** Temps d'attente (ms) sur un verrou SQLite tenu par un autre processus
     *  avant de lever « database is locked ». Backlog 51 (16/10/2026) : depuis
     *  que la reconstruction tourne dans un hook Stop asynchrone, le hook de
     *  rappel (UserPromptSubmit) peut lire pendant qu'un autre processus écrit.
     *  Les verrous d'écriture sont courts (un upsert à la fois) : attendre un
     *  peu suffit, échouer immédiatement dégraderait le rappel en `{}` pour rien. */
    busyTimeoutMs?: number;
}
export declare class VectorStore {
    private db;
    private closed;
    constructor(dbPath: string, options?: VectorStoreOptions);
    upsert(path: string, embedding: number[]): void;
    search(queryEmbedding: number[], topK: number): SearchResult[];
    /** Wipes vectors, file hashes, AND the stored fingerprint — found 14/08
     *  (code review) missing the fingerprint reset: without it, a caller that
     *  clears the store and then calls rebuildIfStale() on an unchanged
     *  corpus would see the OLD fingerprint still match, skip rebuilding
     *  entirely, and be left with a silently empty index.
     *
     *  Reused 16/10/2026 (backlog #50) as the whole-store invalidation for an
     *  embedder identity change (see getEmbedderIdentity/setEmbedderIdentity
     *  above and search.ts's rebuildIfStale): that is EXACTLY the scenario
     *  this doc comment already describes — clear the store, then rely on
     *  rebuildIfStale() on a corpus that may be byte-identical to force a
     *  full re-embed. No second method needed for the same job; the meta
     *  table wipe here also drops the identity row itself, so the caller
     *  must call setEmbedderIdentity() again right after clear(). */
    clear(): void;
    /** Removes every chunk belonging to one source file — both the bare
     *  "path" row (short files, no suffix) and any "path#N" rows (chunked
     *  files). Used by incremental rebuilds before re-embedding a changed
     *  file, and when a file disappears from the corpus entirely. */
    deleteChunksForSourcePath(sourcePath: string): void;
    /** path -> content hash, for every source file currently indexed —
     *  the incremental rebuild's basis for "what changed since last time". */
    getFileHashes(): Record<string, string>;
    setFileHash(path: string, hash: string): void;
    deleteFileHash(path: string): void;
    getFingerprint(): string | null;
    setFingerprint(fingerprint: string): void;
    /** Who produced the stored vectors — DEFAULT_MODEL_ID plus the installed
     *  @huggingface/transformers version (see embeddingProvider.ts's
     *  getEmbedderIdentity). `null` covers both "never set" (every index built
     *  before backlog #50, 16/10/2026) and "wiped by clear()" — both cases
     *  must read as "unknown producer, don't trust these vectors", which is
     *  exactly how rebuildIfStale() (search.ts) treats a non-match. Same
     *  meta key/value table as getFingerprint/setFingerprint — no schema
     *  migration needed for a store an older plugin version already created. */
    getEmbedderIdentity(): string | null;
    setEmbedderIdentity(id: string): void;
    /** Idempotent on purpose: callers (tests, cleanup paths) shouldn't have to
     *  track whether close() was already called. */
    close(): void;
}
