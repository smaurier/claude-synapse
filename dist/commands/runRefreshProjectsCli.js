/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/runRefreshProjectsCli.js" \
 *   "${CLAUDE_PLUGIN_DATA}" <rootDir>
 */
import { runRefreshProjects } from "./runRefreshProjects.js";
const LINK_ACTION_LABELS = {
    "already-ok": "déjà lié",
    created: "lien créé",
    recreated: "recréé (mauvaise cible ou cassé)",
    "recreated-after-backup": "sauvegarde + lien créé",
};
async function main() {
    const [pluginDataDir, rootDir] = process.argv.slice(2);
    if (!pluginDataDir || !rootDir) {
        console.error("Usage: runRefreshProjectsCli <pluginDataDir> <rootDir>");
        process.exitCode = 1;
        return;
    }
    try {
        const results = await runRefreshProjects(pluginDataDir, rootDir);
        if (results.length === 0) {
            console.log("synapse: aucun projet Claude Code (.claude/) trouvé sous cette racine.");
            return;
        }
        for (const r of results) {
            console.log(`${r.projectDir} — ${LINK_ACTION_LABELS[r.link.action] ?? r.link.action}`);
        }
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
    }
}
void main();
//# sourceMappingURL=runRefreshProjectsCli.js.map