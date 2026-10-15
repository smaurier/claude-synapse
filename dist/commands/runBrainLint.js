/**
 * The CLI-facing entrypoint for /brain-lint — resolves LocalConfig,
 * loads the real corpus, and runs the fast checks (lintCorpus) plus the
 * deterministic duplicate-candidate detection (findDuplicateCandidates) —
 * two rules (slug collision, verbatim n-gram overlap), no model call.
 */
import { readLocalConfig, defaultLocalConfigPath, readSharedConfig } from "../config/config.js";
import { loadHubCorpus } from "../rag/corpus.js";
import { lintCorpus, findDuplicateCandidates, checkWipLimit, checkSupersessionReferences } from "./brainLint.js";
import { checkCitedCodeDrift, createGitLastCommitDateResolver } from "./citedCodeDrift.js";
export async function runBrainLint(pluginDataDir) {
    const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
    const corpus = loadHubCorpus(local.hubClonePath);
    const shared = readSharedConfig(local.hubClonePath);
    const duplicateCandidates = findDuplicateCandidates(corpus);
    const citedCodeDriftFindings = await checkCitedCodeDrift(corpus, createGitLastCommitDateResolver(local.knownProjectRoots ?? {}));
    const findings = [
        ...lintCorpus(corpus),
        ...checkWipLimit(corpus, new Date(), shared.wipLimit),
        ...checkSupersessionReferences(corpus),
        ...citedCodeDriftFindings,
    ];
    return { findings, duplicateCandidates };
}
//# sourceMappingURL=runBrainLint.js.map