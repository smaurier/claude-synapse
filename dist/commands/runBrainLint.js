/**
 * The CLI-facing entrypoint for /brain-lint — resolves LocalConfig,
 * loads the real corpus, runs the fast checks (lintCorpus) and the
 * RAG-backed merge-candidate check (findMergeCandidates, wired to the
 * real embedLocal — same model as production.ts, same reasoning against
 * ever mixing embedding spaces).
 */
import { readLocalConfig, defaultLocalConfigPath, readSharedConfig } from "../config/config.js";
import { loadCorpus } from "../rag/corpus.js";
import { embedLocal, chunkFileForEmbedding, ensurePinnedEmbeddingModel } from "../rag/embeddingProvider.js";
import { lintCorpus, findMergeCandidatesGuarded, checkWipLimit, checkSupersessionReferences } from "./brainLint.js";
import { checkCitedCodeDrift, createGitLastCommitDateResolver } from "./citedCodeDrift.js";
export async function runBrainLint(pluginDataDir) {
    const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
    ensurePinnedEmbeddingModel(local.hubClonePath);
    const corpus = loadCorpus(local.hubClonePath);
    const shared = readSharedConfig(local.hubClonePath);
    // chunkFileForEmbedding, not the default character heuristic — same
    // token-exact chunker as production.ts, never a second weaker path.
    const merge = await findMergeCandidatesGuarded(corpus, embedLocal, chunkFileForEmbedding, shared.mergeCandidatesMaxFiles);
    const citedCodeDriftFindings = await checkCitedCodeDrift(corpus, createGitLastCommitDateResolver(local.knownProjectRoots ?? {}));
    const findings = [
        ...lintCorpus(corpus),
        ...checkWipLimit(corpus, new Date(), shared.wipLimit),
        ...checkSupersessionReferences(corpus),
        ...citedCodeDriftFindings,
        ...merge.findings,
    ];
    return { findings, mergeCandidates: merge.mergeCandidates };
}
//# sourceMappingURL=runBrainLint.js.map