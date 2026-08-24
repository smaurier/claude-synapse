/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseUninstallCli.js" \
 *   "${CLAUDE_PLUGIN_DATA}" <linkPath>
 */
import { runSynapseUninstall } from "./synapseUninstall.js";
async function main() {
    const [pluginDataDir, linkPath] = process.argv.slice(2);
    if (!pluginDataDir || !linkPath) {
        console.error("Usage: synapseUninstallCli <pluginDataDir> <linkPath>");
        process.exitCode = 1;
        return;
    }
    try {
        const result = await runSynapseUninstall({ pluginDataDir, linkPath });
        console.log(result.linkRemoved ? "synapse: lien retiré." : "synapse: aucun lien trouvé à cet emplacement.");
        console.log(result.localConfigRemoved
            ? "synapse: config locale supprimée."
            : "synapse: aucune config locale à supprimer.");
        console.log("synapse: le clone du hub sur ce poste n'a pas été touché — c'est un dépôt git réel.");
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
    }
}
void main();
//# sourceMappingURL=synapseUninstallCli.js.map