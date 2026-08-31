/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/syncStatusCli.js" \
 *   "${CLAUDE_PLUGIN_DATA}"
 *
 * Emits one line summary at SessionStart (or on demand via
 * /synapse-sync-status). Also silently bootstraps sync-watch.json with the
 * default (empty) config on first run so the user has something to edit.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getSyncStatus, formatSyncStatusLine, saveWatchConfig, DEFAULT_WATCH_CONFIG, } from "./syncStatus.js";
import { readLocalConfig, defaultLocalConfigPath } from "../config/config.js";
async function main() {
    const [pluginDataDir] = process.argv.slice(2);
    if (!pluginDataDir) {
        console.error("Usage: syncStatusCli <pluginDataDir>");
        process.exitCode = 1;
        return;
    }
    const configPath = join(pluginDataDir, "sync-watch.json");
    if (!existsSync(configPath)) {
        saveWatchConfig(pluginDataDir, DEFAULT_WATCH_CONFIG);
    }
    let hubClonePath;
    try {
        const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
        hubClonePath = local.hubClonePath;
    }
    catch {
        // No local config yet — the memory hub isn't linked. sync-status can
        // still report on explicit / scanPaths repos.
    }
    try {
        const opts = hubClonePath !== undefined ? { hubClonePath } : {};
        const result = await getSyncStatus(pluginDataDir, opts);
        console.log(formatSyncStatusLine(result.repos));
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
    }
}
void main();
//# sourceMappingURL=syncStatusCli.js.map