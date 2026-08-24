/**
 * Backlog 16/08 (étude de marché Synapse) — replaces the originally-scanned
 * idea "retroactively index every session transcript" (deja-vu's model):
 * judged disproportionate and contrary to Synapse's thesis, "a curated
 * corpus you query, not a session observer" — see project memory for the
 * full reasoning. This is the scoped-down version: a plain directory of
 * dates/machines/titles, answering the exact anxiety felt building this
 * feature ("is my work still there?") without a semantic-mining pipeline.
 *
 * Claude Code writes one JSONL file per session at
 * `~/.claude/projects/<slug>/<sessionId>.jsonl` — a project directory per
 * working-directory slug, never something Synapse has read before this.
 * Reads the WHOLE file to find its title, not a bounded prefix: simplest
 * correct thing, matching this codebase's bias (loadCorpus does the same
 * for the hub itself) — unmeasured against very large real transcripts, a
 * assumption to revisit if it's ever felt as slow in practice, the same
 * way findMergeCandidates's O(n²) cost was only bounded after it was
 * actually measured (16/08, scripts/scale-test.mjs), not guessed at ahead
 * of time.
 */
export declare function defaultClaudeProjectsDir(): string;
/**
 * A session's title can be rewritten several times as Claude Code refines
 * it over the conversation (real duplicate/updated `ai-title` lines seen
 * in actual transcripts) — the LAST one in the file is the most accurate,
 * never the first. Malformed lines (partial writes, a truncated final
 * line from a session that ended mid-write) are skipped rather than
 * thrown on, same defensive posture as extractFrontmatter treating an
 * unparseable block as absent rather than fatal.
 */
export declare function parseSessionTitle(content: string): string | null;
export interface SessionSummary {
    slug: string;
    sessionId: string;
    /** File mtime — Claude Code's own last-write time for this session,
     *  not something Synapse tracks separately. */
    mtimeMs: number;
    /** null when the transcript has no ai-title line yet (very short/just-
     *  started sessions) — the CLI falls back to the session id. */
    title: string | null;
}
export declare function findRecentSessions(claudeProjectsDir: string, limit?: number): SessionSummary[];
