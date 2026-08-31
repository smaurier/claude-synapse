/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/syncStatusCli.js" \
 *   "${CLAUDE_PLUGIN_DATA}"
 *
 * Emits one line summary at SessionStart (or on demand via
 * /synapse-sync-status). Also silently bootstraps sync-watch.json with the
 * default (empty) config on first run so the user has something to edit.
 */
export {};
