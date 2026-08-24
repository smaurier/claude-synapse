/**
 * The CLI-facing entrypoint for /brain-lint — resolves LocalConfig,
 * loads the real corpus, runs the fast checks (lintCorpus) and the
 * RAG-backed merge-candidate check (findMergeCandidates, wired to the
 * real embedLocal — same model as production.ts, same reasoning against
 * ever mixing embedding spaces).
 */
import { type LintFinding, type MergeCandidate } from "./brainLint.js";
export interface BrainLintReport {
    findings: LintFinding[];
    mergeCandidates: MergeCandidate[];
}
export declare function runBrainLint(pluginDataDir: string): Promise<BrainLintReport>;
