/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseConfigCli.js" \
 *   "${CLAUDE_PLUGIN_DATA}" show
 *   "${CLAUDE_PLUGIN_DATA}" set <key> <value>
 *   "${CLAUDE_PLUGIN_DATA}" forget-machine <machineId>
 */
import { showSynapseConfig, setSynapseConfig, forgetMachine, EDITABLE_KEYS } from "./synapseConfig.js";
const ACTIONS = ["show", "set", "forget-machine"];
async function main() {
    const [pluginDataDir, action, key, value] = process.argv.slice(2);
    if (!pluginDataDir || action === undefined || !ACTIONS.includes(action)) {
        console.error("Usage: synapseConfigCli <pluginDataDir> show | set <key> <value> | forget-machine <machineId>");
        process.exitCode = 1;
        return;
    }
    try {
        if (action === "show") {
            console.log(JSON.stringify(await showSynapseConfig(pluginDataDir), null, 2));
            return;
        }
        if (action === "forget-machine") {
            if (!key) {
                console.error("Usage: synapseConfigCli <pluginDataDir> forget-machine <machineId>");
                process.exitCode = 1;
                return;
            }
            const updated = await forgetMachine(pluginDataDir, key);
            console.log(`synapse: poste "${key}" retiré du registre.`);
            console.log(JSON.stringify(updated.knownMachines, null, 2));
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