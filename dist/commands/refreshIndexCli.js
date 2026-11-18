/**
 * The actual process entrypoint invoked by the SessionStart hook
 * (hooks/hooks.json):
 *   node "${CLAUDE_PLUGIN_ROOT}/dist/commands/refreshIndexCli.js" \
 *     "${CLAUDE_PLUGIN_DATA}" "${CLAUDE_PROJECT_DIR}"
 *
 * The second argument is optional (older/simpler invocations still work).
 *
 * Deliberately thin, same rationale as brainSearchCli.ts. Failures here are
 * non-blocking by design (exit 1, never 2 — a hook exiting 2 blocks the
 * session per hooks.md, and a stale search index is never worth blocking a
 * session over) except for the expected "not initialized yet" state, which
 * is silent: every session before the first /synapse-init would otherwise
 * print an alarming error for a perfectly normal pre-setup condition.
 */
import { existsSync } from "node:fs";
import { defaultLocalConfigPath } from "../config/config.js";
import { ensureDependencies, resolvePluginRoot } from "../config/dependencies.js";
import { releaseRefreshLock, withRefreshLock } from "../lock/refreshLock.js";
import { stopAfter } from "../rag/search.js";
import { lowerOwnPriority } from "./processPriority.js";
import { armHardStop, recordRefreshRun, refreshLockMaxAgeMs, refreshMaxMs } from "./refreshCeiling.js";
import { runRefreshIndex } from "./refreshIndex.js";
async function main() {
    const [pluginDataDir, projectDir] = process.argv.slice(2);
    if (!pluginDataDir) {
        console.error("Usage: refreshIndexCli <pluginDataDir> [projectDir]");
        process.exitCode = 1;
        return;
    }
    // Checked explicitly rather than pattern-matching readLocalConfig's error
    // message: a string match would also silently swallow a genuine path
    // resolution bug that happens to produce a similar-looking error, hiding
    // exactly the kind of failure this hook should surface.
    if (!existsSync(defaultLocalConfigPath(pluginDataDir))) {
        return; // not initialized yet — normal, nothing to refresh
    }
    lowerOwnPriority();
    const startedAt = Date.now();
    const pluginRoot = resolvePluginRoot(import.meta.url);
    const maxMs = refreshMaxMs(pluginDataDir);
    const trace = (outcome, filesEmbedded = 0) => recordRefreshRun(pluginDataDir, { outcome, durationMs: Date.now() - startedAt, filesEmbedded, pluginRoot });
    try {
        const run = await withRefreshLock(pluginDataDir, refreshLockMaxAgeMs(maxMs), async () => {
            armHardStop(maxMs, () => {
                trace("arrêt forcé");
                releaseRefreshLock(pluginDataDir);
            });
            // A plain `git clone` install (see dependencies.ts) never runs `npm
            // install` — first real invocation of this hook self-heals it. Cheap
            // no-op check on every session after the first. Under the lock: two
            // sessions must not run `npm install` in the same folder either.
            ensureDependencies(pluginRoot);
            return runRefreshIndex(pluginDataDir, projectDir, pluginRoot, stopAfter(maxMs));
        });
        if (!run.ran) {
            const holder = run.heldByPid === null ? "un autre processus" : `le processus ${run.heldByPid}`;
            console.log(`synapse: un rafraîchissement de l'index tourne déjà (${holder}, depuis ${run.since}), rien à faire.`);
            trace("déjà en cours");
            return;
        }
        const result = run.value;
        trace(result.indexCompleted ? "terminé" : "interrompu au plafond", result.filesEmbedded);
        if (!result.indexCompleted) {
            console.log(`synapse: rafraîchissement de l'index interrompu au plafond de ${maxMs / 1000} s, la suite au prochain lancement.`);
        }
        if (result.indexCompacted) {
            const mo = (bytes) => (bytes / 1e6).toFixed(1);
            console.log(`synapse: index compacté, ${mo(result.indexCompacted.beforeBytes)} Mo → ${mo(result.indexCompacted.afterBytes)} Mo.`);
        }
        if (result.auditTriggered && result.auditReport) {
            const r = result.auditReport;
            console.log(`synapse: audit périodique déclenché (cadence dépassée) — ${r.fileCount} fichiers, ${r.findings.length} signalement(s), ${r.duplicateCandidates.length} doublon(s) probable(s).`);
        }
        if (result.ideasRefreshDue) {
            console.log("synapse: synthèse des idées en retard (cadence dépassée) — invoquer /synapse-ideas-refresh.");
        }
    }
    catch (err) {
        trace("échec");
        const message = err instanceof Error ? err.message : String(err);
        console.error(`synapse: échec du rafraîchissement de l'index — ${message}`);
        process.exitCode = 1;
    }
}
void main();
//# sourceMappingURL=refreshIndexCli.js.map