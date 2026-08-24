/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/syncBrainCli.js" "${CLAUDE_PLUGIN_DATA}"
 *
 * Invoked from the SessionEnd hook. Failures here are non-blocking by
 * design (exit 1, never 2), same rationale as refreshIndexCli — a sync
 * that didn't happen this session isn't worth blocking on, it'll retry
 * next time. The one thing this CLI is loud about on purpose is a detected
 * secret: silence there would defeat the entire point of scanning.
 */
export {};
