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
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
// Type-only import: erased at compile time, so it never hits Vite's runtime
// module resolution (only the value above does, hence the workaround).
type DatabaseSyncInstance = InstanceType<typeof import("node:sqlite").DatabaseSync>;

export interface SearchResult {
  path: string;
  score: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
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
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class VectorStore {
  private db: DatabaseSyncInstance;
  private closed = false;

  constructor(dbPath: string) {
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
    `);
  }

  upsert(path: string, embedding: number[]): void {
    this.db
      .prepare("INSERT INTO vectors (path, embedding) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET embedding = excluded.embedding")
      .run(path, JSON.stringify(embedding));
  }

  search(queryEmbedding: number[], topK: number): SearchResult[] {
    const rows = this.db.prepare("SELECT path, embedding FROM vectors").all() as Array<{
      path: string;
      embedding: string;
    }>;

    return rows
      .map((row) => ({
        path: row.path,
        score: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding) as number[]),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  clear(): void {
    this.db.exec("DELETE FROM vectors");
  }

  getFingerprint(): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'fingerprint'").get() as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setFingerprint(fingerprint: string): void {
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES ('fingerprint', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(fingerprint);
  }

  /** Idempotent on purpose: callers (tests, cleanup paths) shouldn't have to
   *  track whether close() was already called. */
  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }
}
