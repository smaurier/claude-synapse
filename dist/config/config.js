/**
 * Two-layer config, per design decision (problème 2, 13/08):
 *
 *  - SharedConfig lives INSIDE the hub (.synapse/config.json), versioned and
 *    synced like everything else in the hub repo. It holds anything that
 *    must agree across machines to avoid drift — most notably the pinned
 *    RAG embedding model version, which is how the RAG divergence problem
 *    gets solved: both machines read the same file after every pull.
 *
 *  - LocalConfig lives OUTSIDE the hub, one file per machine, never synced.
 *    It only holds what genuinely cannot be shared: the hub URL itself
 *    (needed before anything can be cloned), the local clone path, and a
 *    machine identifier.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
export const DEFAULT_SHARED_CONFIG = {
    version: 1,
    refreshProjectsExclusions: [],
    ragEmbeddingModelVersion: "unset",
    lockTimeoutMinutes: 10,
    auditCadenceDays: 14,
    lastAuditAt: null,
    wipLimit: 5,
    marketWatchExtraSources: [],
    mergeCandidatesMaxFiles: 500,
    knownMachines: {},
    refreshProjectsRoots: [],
    corpusRoot: ".",
};
function sharedConfigPath(hubDir) {
    return join(hubDir, ".synapse", "config.json");
}
/** Missing file -> defaults (first machine ever). Existing file -> defaults merged
 *  under its contents, so a config written by an older plugin version that's
 *  missing a newer field still reads cleanly instead of crashing. */
export function readSharedConfig(hubDir) {
    const path = sharedConfigPath(hubDir);
    if (!existsSync(path)) {
        return { ...DEFAULT_SHARED_CONFIG };
    }
    const onDisk = JSON.parse(readFileSync(path, "utf8"));
    return { ...DEFAULT_SHARED_CONFIG, ...onDisk };
}
/** The directory the RAG corpus loader should actually scan for this hub —
 *  the hub root itself unless SharedConfig.corpusRoot narrows it to a
 *  subdirectory. Centralized here (not left to each RAG call site) so
 *  searchHub/hybridSearchHub/refreshHubIndex can never disagree on it. */
export function resolveCorpusRoot(hubClonePath) {
    const { corpusRoot } = readSharedConfig(hubClonePath);
    return corpusRoot === "." ? hubClonePath : join(hubClonePath, corpusRoot);
}
export function writeSharedConfig(hubDir, config) {
    const path = sharedConfigPath(hubDir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
}
export function readLocalConfig(path) {
    if (!existsSync(path)) {
        throw new Error(`synapse: aucune config locale trouvée à "${path}". Lancer /synapse-init d'abord.`);
    }
    return JSON.parse(readFileSync(path, "utf8"));
}
export function writeLocalConfig(path, config) {
    if (!config.hubUrl || config.hubUrl.trim() === "") {
        throw new Error("synapse: hubUrl est requis pour la config locale (impossible de cloner sans URL).");
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
}
/**
 * Default on-disk locations, anchored to the plugin's per-machine data
 * directory (decided 14/08: ${CLAUDE_PLUGIN_DATA}, ~/.claude/plugins/data/synapse/
 * — documented, per-machine, survives plugin updates unlike
 * ${CLAUDE_PLUGIN_ROOT}). These take that directory as a plain parameter
 * rather than reading process.env.CLAUDE_PLUGIN_DATA themselves: env var
 * inheritance is confirmed for hook processes but NOT documented for a
 * Bash process launched from a skill — the real CLI entrypoint resolves it
 * once (via an explicit CLI argument substituted into the skill's command
 * text) and passes it down. Nothing in this module reaches for ambient
 * process state.
 */
export function defaultLocalConfigPath(pluginDataDir) {
    return join(pluginDataDir, "local-config.json");
}
export function defaultHubClonePath(pluginDataDir) {
    return join(pluginDataDir, "hub");
}
/**
 * Records this machine's presence on the hub — the device registry (see
 * SharedConfig.knownMachines). Called on every SessionStart, unlocked on
 * purpose: this is a soft "who's using this hub" signal, not something a
 * lost update under a rare concurrent-write race would meaningfully break —
 * that machine's timestamp just lags one session behind, self-correcting
 * the next time it starts a session.
 */
export function recordMachineSeen(hubClonePath, machineId, now = new Date()) {
    const shared = readSharedConfig(hubClonePath);
    writeSharedConfig(hubClonePath, { ...shared, knownMachines: { ...shared.knownMachines, [machineId]: now.toISOString() } });
}
//# sourceMappingURL=config.js.map