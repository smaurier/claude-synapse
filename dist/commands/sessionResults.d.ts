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
import type { HybridResult } from "../rag/hybridSearch.js";
export interface StoredSessionResults {
    query: string;
    results: HybridResult[];
}
export declare function writeSessionResults(pluginDataDir: string, sessionId: string, query: string, results: HybridResult[]): void;
export declare function readSessionResults(pluginDataDir: string, sessionId: string): StoredSessionResults | null;
/**
 * Bounded defensively at a conservative size regardless of whatever the
 * platform's real additionalContext cap turns out to be (reported to us
 * as ~10 000 chars, unconfirmed independently — better to stay well under
 * an unverified number than to rely on it being exactly right).
 */
export declare function formatSessionResultsAsContext(stored: StoredSessionResults | null): string | null;
