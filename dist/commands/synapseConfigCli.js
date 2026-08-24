/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseConfigCli.js" \
 *   "${CLAUDE_PLUGIN_DATA}" show
 *   "${CLAUDE_PLUGIN_DATA}" set <key> <value>
 */
import { showSynapseConfig, setSynapseConfig, EDITABLE_KEYS } from "./synapseConfig.js";
async function main() {
    const [pluginDataDir, action, key, value] = process.argv.slice(2);
    if (!pluginDataDir || (action !== "show" && action !== "set")) {
        console.error('Usage: synapseConfigCli <pluginDataDir> show | set <key> <value>');
        process.exitCode = 1;
        return;
    }
    try {
        if (action === "show") {
            console.log(JSON.stringify(await showSynapseConfig(pluginDataDir), null, 2));
            return;
        }
        if (!key || value === undefined) {
            console.error(`Usage: synapseConfigCli <pluginDataDir> set <key> <value>. Clés : ${EDITABLE_KEYS.join(", ")}.`);
            process.exitCode = 1;
            return;
        }
        console.log(JSON.stringify(await setSynapseConfig(pluginDataDir, key, value), null, 2));
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
    }
}
void main();
//# sourceMappingURL=synapseConfigCli.js.map