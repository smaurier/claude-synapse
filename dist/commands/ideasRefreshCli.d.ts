/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/ideasRefreshCli.js" "${CLAUDE_PLUGIN_DATA}"
 *
 * Called by the `/synapse-ideas-refresh` skill, and only at the end of it —
 * after the actual synthesis work is done, never before. See ideasRefresh.ts
 * for why this can't be the thing that does that work.
 */
export {};
