/**
 * /synapse-config show/set — commande-driven config editing (problème 2:
 * "jamais d'édition manuelle de fichier requise"). Only a deliberately
 * narrow subset of SharedConfig is user-editable: ragEmbeddingModelVersion
 * and lastAuditAt are machine-managed (set by the code, not the user, per
 * their own design sections), version is a schema marker — exposing them
 * for hand-editing here would just invite a bad write.
 *
 * refreshProjectsExclusions was excluded too until 14/08 ("format non
 * tranché" backlog item) — now that the format is decided (comma-separated
 * on the CLI), it and marketWatchExtraSources (added same day, same format:
 * "owner/repo" entries) share a string-list parsing path distinct from the
 * numeric one the other keys use.
 */
import { readLocalConfig, defaultLocalConfigPath, readSharedConfig, writeSharedConfig, DEFAULT_SHARED_CONFIG } from "../config/config.js";
import { acquireLock, releaseLock } from "../lock/lock.js";
export const NUMERIC_EDITABLE_KEYS = ["lockTimeoutMinutes", "auditCadenceDays", "wipLimit", "mergeCandidatesMaxFiles"];
export const STRING_LIST_EDITABLE_KEYS = ["refreshProjectsExclusions", "marketWatchExtraSources", "refreshProjectsRoots"];
export const EDITABLE_KEYS = [...NUMERIC_EDITABLE_KEYS, ...STRING_LIST_EDITABLE_KEYS];
export async function showSynapseConfig(pluginDataDir) {
    const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
    return readSharedConfig(local.hubClonePath);
}
function parseValue(key, rawValue) {
    if (STRING_LIST_EDITABLE_KEYS.includes(key)) {
        return rawValue
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`synapse: valeur invalide "${rawValue}" pour "${key}" — un nombre positif est attendu.`);
    }
    return value;
}
export async function setSynapseConfig(pluginDataDir, key, rawValue) {
    if (!EDITABLE_KEYS.includes(key)) {
        throw new Error(`synapse: clé "${key}" non modifiable via /synapse-config set. Clés valides : ${EDITABLE_KEYS.join(", ")}.`);
    }
    const value = parseValue(key, rawValue);
    const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
    const lockResult = acquireLock(local.hubClonePath, local.machineId, DEFAULT_SHARED_CONFIG.lockTimeoutMinutes);
    if (!lockResult.acquired) {
        throw new Error(`synapse: verrou du hub déjà détenu par "${lockResult.heldBy}" depuis ${lockResult.since} — réessayer dans un instant.`);
    }
    try {
        const current = readSharedConfig(local.hubClonePath);
        const updated = { ...current, [key]: value };
        writeSharedConfig(local.hubClonePath, updated);
        return updated;
    }
    finally {
        releaseLock(local.hubClonePath, local.machineId);
    }
}
//# sourceMappingURL=synapseConfig.js.map