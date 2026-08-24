/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/brainNewCli.js" \
 *   "${CLAUDE_PLUGIN_DATA}" <type> <nom...>
 */
import { readLocalConfig, defaultLocalConfigPath } from "../config/config.js";
import { createMemoryFile, MEMORY_TYPES } from "./brainNew.js";
async function main() {
    const [pluginDataDir, type, ...nameParts] = process.argv.slice(2);
    const name = nameParts.join(" ").trim();
    if (!pluginDataDir || !type || !name) {
        console.error(`Usage: brainNewCli <pluginDataDir> <type> <nom>. Types : ${MEMORY_TYPES.join(", ")}.`);
        process.exitCode = 1;
        return;
    }
    try {
        const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
        const result = createMemoryFile(local.hubClonePath, type, name);
        console.log(`synapse: mémoire créée à "${result.path}".`);
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
    }
}
void main();
//# sourceMappingURL=brainNewCli.js.map