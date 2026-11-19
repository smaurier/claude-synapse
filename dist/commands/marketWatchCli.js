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
import { formatMarketWatchReport, runMarketWatch } from "./marketWatch.js";
function readExtraSources(pluginDataDir) {
    if (!pluginDataDir)
        return [];
    try {
        const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
        return readSharedConfig(local.hubClonePath).marketWatchExtraSources;
    }
    catch {
        // Pas encore de /synapse-init sur ce poste, ou hub illisible — la veille
        // reste utile sur la seule liste connue plutôt que de bloquer dessus.
        return [];
    }
}
async function main() {
    try {
        const [pluginDataDir] = process.argv.slice(2);
        const extraSources = readExtraSources(pluginDataDir);
        const report = await runMarketWatch(fetch, extraSources);
        for (const line of formatMarketWatchReport(report, new Date()))
            console.log(line);
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
    }
}
void main();
//# sourceMappingURL=marketWatchCli.js.map