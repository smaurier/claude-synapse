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
// Static `import ... from "node:sqlite"` trips up Vite/Vitest's module
// resolution — this builtin is too recent (Node 22.5+, still experimental)
// to be in its known-builtins list, so it tries to resolve "sqlite" as a
// package and fails. process.getBuiltinModule() fetches it directly from
// the runtime, bypassing that resolution entirely.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
export function cosineSimilarity(a, b) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        const ai = a[i] ?? 0;
        const bi = b[i] ?? 0;
        dot += ai * bi;
        normA += ai * ai;
        normB += bi * bi;
    }
    if (normA === 0 || normB === 0)
        return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
export class VectorStore {
    db;
    closed = false;
    constructor(dbPath) {
        this.db = new DatabaseSync(dbPath);
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        path TEXT PRIMARY KEY,
        embedding TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS file_hashes (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL
      );
    `);
    }
    upsert(path, embedding) {
        this.db
            .prepare("INSERT INTO vectors (path, embedding) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET embedding = excluded.embedding")
            .run(path, JSON.stringify(embedding));
    }
    search(queryEmbedding, topK) {
        const rows = this.db.prepare("SELECT path, embedding FROM vectors").all();
        return rows
            .map((row) => ({
            path: row.path,
            score: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding)),
        }))
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }
    /** Wipes vectors, file hashes, AND the stored fingerprint — found 14/08
     *  (code review) missing the fingerprint reset: without it, a caller that
     *  clears the store and then calls rebuildIfStale() on an unchanged
     *  corpus would see the OLD fingerprint still match, skip rebuilding
     *  entirely, and be left with a silently empty index. */
    clear() {
        this.db.exec("DELETE FROM vectors");
        this.db.exec("DELETE FROM file_hashes");
        this.db.exec("DELETE FROM meta");
    }
    /** Removes every chunk belonging to one source file — both the bare
     *  "path" row (short files, no suffix) and any "path#N" rows (chunked
     *  files). Used by incremental rebuilds before re-embedding a changed
     *  file, and when a file disappears from the corpus entirely. */
    deleteChunksForSourcePath(sourcePath) {
        this.db.prepare("DELETE FROM vectors WHERE path = ? OR path LIKE ?").run(sourcePath, `${sourcePath}#%`);
    }
    /** path -> content hash, for every source file currently indexed —
     *  the incremental rebuild's basis for "what changed since last time". */
    getFileHashes() {
        const rows = this.db.prepare("SELECT path, hash FROM file_hashes").all();
        return Object.fromEntries(rows.map((r) => [r.path, r.hash]));
    }
    setFileHash(path, hash) {
        this.db
            .prepare("INSERT INTO file_hashes (path, hash) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET hash = excluded.hash")
            .run(path, hash);
    }
    deleteFileHash(path) {
        this.db.prepare("DELETE FROM file_hashes WHERE path = ?").run(path);
    }
    getFingerprint() {
        const row = this.db.prepare("SELECT value FROM meta WHERE key = 'fingerprint'").get();
        return row?.value ?? null;
    }
    setFingerprint(fingerprint) {
        this.db
            .prepare("INSERT INTO meta (key, value) VALUES ('fingerprint', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .run(fingerprint);
    }
    /** Idempotent on purpose: callers (tests, cleanup paths) shouldn't have to
     *  track whether close() was already called. */
    close() {
        if (this.closed)
            return;
        this.db.close();
        this.closed = true;
    }
}
//# sourceMappingURL=store.js.map