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
}
export declare function cosineSimilarity(a: number[], b: number[]): number;
export declare class VectorStore {
    private db;
    private closed;
    constructor(dbPath: string);
    upsert(path: string, embedding: number[]): void;
    search(queryEmbedding: number[], topK: number): SearchResult[];
    /** Wipes vectors, file hashes, AND the stored fingerprint — found 14/08
     *  (code review) missing the fingerprint reset: without it, a caller that
     *  clears the store and then calls rebuildIfStale() on an unchanged
     *  corpus would see the OLD fingerprint still match, skip rebuilding
     *  entirely, and be left with a silently empty index. */
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
    /** Idempotent on purpose: callers (tests, cleanup paths) shouldn't have to
     *  track whether close() was already called. */
    close(): void;
}
