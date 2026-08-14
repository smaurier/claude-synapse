/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/marketWatchCli.js"
 * No pluginDataDir needed — this doesn't touch the hub at all, pure
 * public GitHub API reads.
 */

import { runMarketWatch } from "./marketWatch.js";

async function main(): Promise<void> {
  try {
    const report = await runMarketWatch();

    console.log("Concurrents connus (par étoiles) :");
    for (const r of report.knownCompetitors) {
      console.log(`  ${r.fullName} — ${r.stars}★ (${r.url})`);
    }

    if (report.possibleNewEntrants.length > 0) {
      console.log("Nouveaux entrants possibles (non déjà suivis) :");
      for (const r of report.possibleNewEntrants.slice(0, 10)) {
        console.log(`  ${r.fullName} — ${r.stars}★ (${r.url})`);
      }
    } else {
      console.log("Aucun nouvel entrant détecté.");
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

main();
