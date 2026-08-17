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

import { runBrainSearch, formatSearchResult } from "./brainSearch.js";
import { writeSessionResults } from "./sessionResults.js";

async function main(): Promise<void> {
  const [pluginDataDir, sessionId, ...queryParts] = process.argv.slice(2);
  const query = queryParts.join(" ").trim();

  if (!pluginDataDir || !sessionId || !query) {
    console.error("Usage: brainSearchCli <pluginDataDir> <sessionId> <query>");
    process.exitCode = 1;
    return;
  }

  try {
    const results = await runBrainSearch(pluginDataDir, query);

    try {
      writeSessionResults(pluginDataDir, sessionId, query, results);
    } catch {
      // Best-effort persistence for PostCompact — never worth failing the
      // actual search over.
    }

    if (results.length === 0) {
      console.log("Aucun résultat.");
      return;
    }
    for (const r of results) {
      console.log(formatSearchResult(r));
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

void main();
