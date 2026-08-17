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

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultClaudeProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

/**
 * A session's title can be rewritten several times as Claude Code refines
 * it over the conversation (real duplicate/updated `ai-title` lines seen
 * in actual transcripts) — the LAST one in the file is the most accurate,
 * never the first. Malformed lines (partial writes, a truncated final
 * line from a session that ended mid-write) are skipped rather than
 * thrown on, same defensive posture as extractFrontmatter treating an
 * unparseable block as absent rather than fatal.
 */
export function parseSessionTitle(content: string): string | null {
  let title: string | null = null;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      "type" in parsed &&
      (parsed as { type: unknown }).type === "ai-title" &&
      "aiTitle" in parsed &&
      typeof (parsed as { aiTitle: unknown }).aiTitle === "string"
    ) {
      title = (parsed as { aiTitle: string }).aiTitle;
    }
  }
  return title;
}

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

export function findRecentSessions(claudeProjectsDir: string, limit = 10): SessionSummary[] {
  if (!existsSync(claudeProjectsDir)) return [];

  const summaries: SessionSummary[] = [];
  for (const slug of readdirSync(claudeProjectsDir)) {
    const slugDir = join(claudeProjectsDir, slug);
    if (!statSync(slugDir).isDirectory()) continue;

    for (const entry of readdirSync(slugDir)) {
      if (!entry.endsWith(".jsonl")) continue;
      const file = join(slugDir, entry);
      const sessionId = entry.slice(0, -".jsonl".length);
      summaries.push({
        slug,
        sessionId,
        mtimeMs: statSync(file).mtimeMs,
        title: parseSessionTitle(readFileSync(file, "utf8")),
      });
    }
  }

  return summaries.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
}
