/**
 * Backlog 16/08 (étude de marché Synapse) — compaction-light. Synapse
 * doesn't observe the session (it's a curated corpus you query, not a
 * session watcher), so there is nothing to condense at compaction time
 * the way agentmemory/pro-workflow/mira-OSS do. The version that fits
 * here is narrower: persist the LAST /brain-search results this session
 * ran, keyed by session id, so a PostCompact hook can hand them back.
 *
 * PostCompact, not PreCompact — verified with the Claude Code guide, then
 * cross-checked against 27 real files in the market-study corpus (16/08)
 * before writing a line of code: PreCompact fires before compaction and
 * can't reliably survive it; PostCompact fires after and its output
 * supports `additionalContext`, the same field PostToolUse/UserPromptSubmit
 * use to feed text back into context.
 *
 * One file per session, always overwritten by the latest search — a
 * growing per-session log was deliberately not built: the goal is "what
 * was I just looking at", not a history.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HybridResult } from "../rag/hybridSearch.js";

export interface StoredSessionResults {
  query: string;
  results: HybridResult[];
}

function sessionResultsPath(pluginDataDir: string, sessionId: string): string {
  return join(pluginDataDir, "session-results", `${sessionId}.json`);
}

export function writeSessionResults(pluginDataDir: string, sessionId: string, query: string, results: HybridResult[]): void {
  const path = sessionResultsPath(pluginDataDir, sessionId);
  mkdirSync(join(pluginDataDir, "session-results"), { recursive: true });
  writeFileSync(path, JSON.stringify({ query, results } satisfies StoredSessionResults), "utf8");
}

export function readSessionResults(pluginDataDir: string, sessionId: string): StoredSessionResults | null {
  const path = sessionResultsPath(pluginDataDir, sessionId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as StoredSessionResults;
}

const MAX_CONTEXT_CHARS = 3000;

/**
 * Bounded defensively at a conservative size regardless of whatever the
 * platform's real additionalContext cap turns out to be (reported to us
 * as ~10 000 chars, unconfirmed independently — better to stay well under
 * an unverified number than to rely on it being exactly right).
 */
export function formatSessionResultsAsContext(stored: StoredSessionResults | null): string | null {
  if (!stored || stored.results.length === 0) return null;

  const lines = [`[synapse] derniers résultats de /brain-search cette session, requête : "${stored.query}"`];
  for (const r of stored.results) {
    const label = r.matchType === "exact" ? "exact" : r.score.toFixed(2);
    const suffix = r.supersededBy ? ` (remplacé par ${r.supersededBy})` : "";
    lines.push(`- ${r.path} (${label})${suffix}`);
  }

  let text = lines.join("\n");
  if (text.length > MAX_CONTEXT_CHARS) {
    text = text.slice(0, MAX_CONTEXT_CHARS) + "\n… (tronqué)";
  }
  return text;
}
