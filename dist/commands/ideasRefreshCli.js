/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/ideasRefreshCli.js" "${CLAUDE_PLUGIN_DATA}"
 *
 * Called by the `/synapse-ideas-refresh` skill, and only at the end of it —
 * after the actual synthesis work is done, never before. See ideasRefresh.ts
 * for why this can't be the thing that does that work.
 */
import { readLocalConfig, defaultLocalConfigPath } from "../config/config.js";
import { markIdeasRefreshed } from "./ideasRefresh.js";
async function main() {
    const [pluginDataDir] = process.argv.slice(2);
    if (!pluginDataDir) {
        console.error("Usage: ideasRefreshCli <pluginDataDir>");
        process.exitCode = 1;
        return;
    }
    const localConfig = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
    const result = markIdeasRefreshed(localConfig.hubClonePath, localConfig.machineId);
    if (!result.written) {
        console.error("synapse: horodatage non écrit — un autre poste détient le verrou, réessayer plus tard.");
        process.exitCode = 1;
        return;
    }
    console.log("synapse: synthèse des idées marquée à jour.");
}
void main();
//# sourceMappingURL=ideasRefreshCli.js.map