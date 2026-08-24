/**
 * /brain-status — a quick health snapshot, composing already-tested pieces
 * (LocalConfig, jonction state, corpus size, audit cadence) rather than
 * introducing new logic. Distinct from /synapse-doctor (broader, report-
 * only, not built yet): this is the fast single-project check.
 */
import { readLocalConfig, defaultLocalConfigPath, readSharedConfig } from "../config/config.js";
import { inspectLink } from "../jonction/jonction.js";
import { loadCorpus } from "../rag/corpus.js";
export async function getBrainStatus(pluginDataDir, linkPath) {
    const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
    const shared = readSharedConfig(local.hubClonePath);
    const linkState = inspectLink(linkPath, local.hubClonePath);
    const corpus = loadCorpus(local.hubClonePath);
    return {
        hubClonePath: local.hubClonePath,
        linkState,
        fileCount: corpus.length,
        lastAuditAt: shared.lastAuditAt,
        auditCadenceDays: shared.auditCadenceDays,
    };
}
//# sourceMappingURL=brainStatus.js.map