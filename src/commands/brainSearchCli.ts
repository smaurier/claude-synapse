/**
 * The actual process entrypoint invoked by skills/brain-search/SKILL.md:
 *   node "${CLAUDE_PLUGIN_ROOT}/dist/commands/brainSearchCli.js" "${CLAUDE_PLUGIN_DATA}" <query>
 *
 * Deliberately thin: all real logic lives in brainSearch.ts (testable
 * without a process boundary). This file only parses argv, prints, and sets
 * the exit code — not unit-tested itself, same as any argv-parsing shim.
 */

import { runBrainSearch } from "./brainSearch.js";

async function main(): Promise<void> {
  const [pluginDataDir, ...queryParts] = process.argv.slice(2);
  const query = queryParts.join(" ").trim();

  if (!pluginDataDir || !query) {
    console.error("Usage: brainSearchCli <pluginDataDir> <query>");
    process.exitCode = 1;
    return;
  }

  try {
    const results = await runBrainSearch(pluginDataDir, query);
    if (results.length === 0) {
      console.log("Aucun résultat.");
      return;
    }
    for (const r of results) {
      const label = r.matchType === "exact" ? "correspondance exacte" : r.score.toFixed(3);
      console.log(`${label}  ${r.path}`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

main();
