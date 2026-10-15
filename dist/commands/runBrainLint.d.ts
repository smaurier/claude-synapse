/**
 * The CLI-facing entrypoint for /brain-lint — resolves LocalConfig,
 * loads the real corpus, and runs the fast checks (lintCorpus) plus the
 * deterministic duplicate-candidate detection (findDuplicateCandidates) —
 * two rules (slug collision, verbatim n-gram overlap), no model call.
 */
import { type LintFinding, type DuplicateCandidate } from "./brainLint.js";
export interface BrainLintReport {
    findings: LintFinding[];
    duplicateCandidates: DuplicateCandidate[];
}
export declare function runBrainLint(pluginDataDir: string): Promise<BrainLintReport>;
