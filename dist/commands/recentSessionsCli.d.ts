/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/recentSessionsCli.js" [limit]
 *
 * No pluginDataDir needed, unlike every other *Cli.ts here — this reads
 * Claude Code's own ~/.claude/projects/ directly, never touches the hub.
 */
export {};
