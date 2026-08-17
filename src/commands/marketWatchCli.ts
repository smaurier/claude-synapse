/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/marketWatchCli.js" "${CLAUDE_PLUGIN_DATA}"
 *
 * Revu le 14/08 : prend désormais pluginDataDir, contrairement au design
 * initial ("ne touche pas le hub, lectures GitHub publiques pures") — pour
 * lire SharedConfig.marketWatchExtraSources (sources ajoutées par
 * l'utilisateur, cf config.ts). pluginDataDir reste optionnel : sans lien
 * hub configuré, le rapport se limite à KNOWN_COMPETITORS plutôt que
 * d'échouer — cette commande reste utilisable avant tout /synapse-init.
 */

import { readLocalConfig, defaultLocalConfigPath, readSharedConfig } from "../config/config.js";
import { runMarketWatch } from "./marketWatch.js";

function readExtraSources(pluginDataDir: string | undefined): string[] {
  if (!pluginDataDir) return [];
  try {
    const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
    return readSharedConfig(local.hubClonePath).marketWatchExtraSources;
  } catch {
    // Pas encore de /synapse-init sur ce poste, ou hub illisible — la veille
    // reste utile sur la seule liste connue plutôt que de bloquer dessus.
    return [];
  }
}

async function main(): Promise<void> {
  try {
    const [pluginDataDir] = process.argv.slice(2);
    const extraSources = readExtraSources(pluginDataDir);
    const report = await runMarketWatch(fetch, extraSources);

    console.log("Concurrents connus (par étoiles) :");
    for (const r of report.knownCompetitors) {
      console.log(`  ${r.fullName} — ${r.stars}★, dernier push ${r.pushedAt} (${r.url})`);
    }

    if (report.possibleNewEntrants.length > 0) {
      console.log("Nouveaux entrants possibles (non déjà suivis, plusieurs requêtes dont une par topic) :");
      for (const r of report.possibleNewEntrants.slice(0, 10)) {
        console.log(`  ${r.fullName} — ${r.stars}★, dernier push ${r.pushedAt} (${r.url})`);
      }
    } else {
      console.log("Aucun nouvel entrant détecté.");
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

void main();
