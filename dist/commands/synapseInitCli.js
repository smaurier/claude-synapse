/**
 * The actual process entrypoint invoked by skills/synapse-init/SKILL.md:
 *   node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseInitCli.js" \
 *     "${CLAUDE_PLUGIN_DATA}" <hubUrl> <linkPath> [hubClonePath] [corpusRoot]
 *
 * The two trailing args are optional and only needed for the "adopt an
 * existing directory as hub" path (added 24/08): pass the existing clone's
 * own path as hubClonePath (same value as linkPath, typically) so
 * cloneOrPullHub pulls instead of cloning and ensureHubLink treats it as
 * self-hosting (see jonction.ts / synapseInit.ts doc comments) — and
 * corpusRoot when the hub root also holds non-memory material (docs,
 * scripts) that indexing shouldn't see.
 *
 * Deliberately thin, same rationale as the other *Cli.ts entrypoints.
 */
import { runSynapseInit } from "./synapseInit.js";
const LINK_ACTION_LABELS = {
    "already-ok": "déjà lié correctement — rien à faire.",
    created: "lien créé.",
    recreated: "lien existant incorrect (mauvaise cible ou cassé) — recréé.",
    "recreated-after-backup": "du contenu réel existait à cet emplacement — sauvegardé, puis lien créé.",
};
async function main() {
    const [pluginDataDir, hubUrl, linkPath, hubClonePath, corpusRoot] = process.argv.slice(2);
    if (!pluginDataDir || !hubUrl || !linkPath) {
        console.error("Usage: synapseInitCli <pluginDataDir> <hubUrl> <linkPath> [hubClonePath] [corpusRoot]");
        process.exitCode = 1;
        return;
    }
    try {
        const result = await runSynapseInit({
            pluginDataDir,
            hubUrl,
            linkPath,
            ...(hubClonePath ? { hubClonePath } : {}),
            ...(corpusRoot ? { corpusRoot } : {}),
        });
        console.log(`synapse: hub prêt dans "${result.hubClonePath}".`);
        console.log(`synapse: ${LINK_ACTION_LABELS[result.link.action] ?? result.link.action}`);
        if (result.link.backupPath) {
            console.log(`synapse: sauvegarde visible à "${result.link.backupPath}".`);
        }
        if (result.visibilityWarning) {
            console.log(result.visibilityWarning);
        }
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
    }
}
void main();
//# sourceMappingURL=synapseInitCli.js.map