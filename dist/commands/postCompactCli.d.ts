/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/postCompactCli.js" "${CLAUDE_PLUGIN_DATA}"
 *
 * Invoked by the PostCompact hook (hooks/hooks.json). Reads the hook's
 * stdin JSON payload for `session_id` (confirmed present, via the Claude
 * Code guide — 16/08 — then cross-checked against real hooks.json/output
 * shapes in the market-study corpus rather than trusting either source
 * alone). Prints the universal hook output schema on stdout; an empty
 * `{}` (no additionalContext key) is a normal, silent no-op — most
 * compactions won't have a pending search to restore.
 *
 * Never blocks or errors the session over this: any failure here (bad
 * JSON, missing session_id, fs error) degrades to printing `{}`, same
 * best-effort posture as the write side in brainSearchCli.ts.
 */
export {};
