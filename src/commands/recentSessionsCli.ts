/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/recentSessionsCli.js" [limit]
 *
 * No pluginDataDir needed, unlike every other *Cli.ts here — this reads
 * Claude Code's own ~/.claude/projects/ directly, never touches the hub.
 */

import { defaultClaudeProjectsDir, findRecentSessions } from "./recentSessions.js";

async function main(): Promise<void> {
  const [limitArg] = process.argv.slice(2);
  const limit = limitArg ? Number.parseInt(limitArg, 10) : 10;

  const sessions = findRecentSessions(defaultClaudeProjectsDir(), Number.isNaN(limit) ? 10 : limit);

  if (sessions.length === 0) {
    console.log("synapse: aucune session Claude Code trouvée sur ce poste.");
    return;
  }

  for (const s of sessions) {
    const date = new Date(s.mtimeMs).toISOString().slice(0, 16).replace("T", " ");
    const title = s.title ?? `(sans titre — ${s.sessionId})`;
    console.log(`${date}  ${title}  [${s.slug}]`);
  }
}

void main();
