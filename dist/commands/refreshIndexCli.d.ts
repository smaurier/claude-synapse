/**
 * The actual process entrypoint invoked by the SessionStart hook
 * (hooks/hooks.json):
 *   node "${CLAUDE_PLUGIN_ROOT}/dist/commands/refreshIndexCli.js" \
 *     "${CLAUDE_PLUGIN_DATA}" "${CLAUDE_PROJECT_DIR}"
 *
 * The second argument is optional (older/simpler invocations still work).
 *
 * Deliberately thin, same rationale as brainSearchCli.ts. Failures here are
 * non-blocking by design (exit 1, never 2 — a hook exiting 2 blocks the
 * session per hooks.md, and a stale search index is never worth blocking a
 * session over) except for the expected "not initialized yet" state, which
 * is silent: every session before the first /synapse-init would otherwise
 * print an alarming error for a perfectly normal pre-setup condition.
 */
export {};
