/**
 * The CLI-facing entrypoint for /brain-lint — resolves LocalConfig,
 * loads the real corpus, runs the fast checks (lintCorpus) and the
 * RAG-backed merge-candidate check (findMergeCandidates, wired to the
 * real embedLocal — same model as production.ts, same reasoning against
 * ever mixing embedding spaces).
 */

import { readLocalConfig, defaultLocalConfigPath } from "../config/config.js";
import { loadCorpus } from "../rag/corpus.js";
import { embedLocal, chunkFileForEmbedding } from "../rag/embeddingProvider.js";
import { lintCorpus, findMergeCandidates, checkWipLimit, type LintFinding, type MergeCandidate } from "./brainLint.js";

export interface BrainLintReport {
  findings: LintFinding[];
  mergeCandidates: MergeCandidate[];
}

export async function runBrainLint(pluginDataDir: string): Promise<BrainLintReport> {
  const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
  const corpus = loadCorpus(local.hubClonePath);

  const findings = [...lintCorpus(corpus), ...checkWipLimit(corpus)];
  // chunkFileForEmbedding, not the default character heuristic — same
  // token-exact chunker as production.ts, never a second weaker path.
  const mergeCandidates = await findMergeCandidates(corpus, embedLocal, chunkFileForEmbedding);

  return { findings, mergeCandidates };
}
