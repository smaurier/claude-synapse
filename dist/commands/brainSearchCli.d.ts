/**
 * The actual process entrypoint invoked by skills/brain-search/SKILL.md:
 *   node "${CLAUDE_PLUGIN_ROOT}/dist/commands/brainSearchCli.js" \
 *     "${CLAUDE_PLUGIN_DATA}" "${CLAUDE_SESSION_ID}" <query>
 *
 * sessionId added 16/08 (backlog: compaction-light) — persists this
 * search's results (sessionResults.ts) so a PostCompact hook can hand
 * them back after compaction. Best-effort: a write failure here must
 * never fail the search itself, so it's swallowed, not surfaced.
 *
 * Deliberately thin: all real logic lives in brainSearch.ts (testable
 * without a process boundary). This file only parses argv, prints, and sets
 * the exit code — not unit-tested itself, same as any argv-parsing shim.
 */
export {};
