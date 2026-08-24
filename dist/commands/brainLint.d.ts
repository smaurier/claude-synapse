/**
 * /brain-lint (périmètre IN) — reports only, never auto-fixes or
 * auto-executes anything (a merge/split/deletion suggestion acted on
 * automatically could conflate two distinct facts in silence, worse than
 * a stale link — see project memory's own reasoning for this). Frontmatter
 * validation needs no YAML library: the convention used is a flat 2-level
 * structure (top-level keys + one nesting level under `metadata:`), simple
 * enough to hand-parse without pulling in a dependency (léger bias).
 */
import { type Chunk } from "../rag/chunk.js";
export interface Frontmatter {
    fields: Record<string, string>;
}
export declare function extractFrontmatter(content: string): Frontmatter | null;
export type LintSeverity = "error" | "warning";
export interface LintFinding {
    path: string;
    severity: LintSeverity;
    message: string;
}
/** One file's checks — frontmatter validity, expiry, and the two
 *  structural heuristics. Pure, fast, no model needed. */
export declare function lintFile(path: string, content: string, today?: Date): LintFinding[];
export declare function lintCorpus(files: {
    path: string;
    content: string;
}[], today?: Date): LintFinding[];
/**
 * WIP limiter (périmètre IN) — counts `project`-type memories that are
 * currently active (expires: ongoing, or a future date) and flags it as a
 * single corpus-wide finding if over the limit. Deliberately a count, not
 * a judgment call about which projects to close — that's for the user.
 */
export declare function checkWipLimit(files: {
    path: string;
    content: string;
}[], today?: Date, limit?: number): LintFinding[];
/**
 * Backlog 16/08 (agentic-stack's superseded_by, refined after review): flags
 * a `metadata.superseded_by: <path>` that names a file absent from the
 * corpus — hybridSearch.ts deliberately ignores this case rather than
 * annotating a link to nothing (see applySupersession()), so this is the
 * one place it actually gets surfaced to the user. A dangling reference
 * usually means a rename/typo, or the replacement was deleted without
 * updating the pointer — worth a look, not a silent no-op forever.
 */
export declare function checkSupersessionReferences(files: {
    path: string;
    content: string;
}[]): LintFinding[];
export interface MergeCandidate {
    a: string;
    b: string;
    score: number;
}
export declare function findMergeCandidates(files: {
    path: string;
    content: string;
}[], embed: (text: string) => number[] | Promise<number[]>, chunkFn?: (path: string, content: string) => Chunk[] | Promise<Chunk[]>, threshold?: number): Promise<MergeCandidate[]>;
/**
 * The size-guarded entrypoint real callers use instead of findMergeCandidates
 * directly. Above maxFiles, skips the O(n²) comparison entirely and reports
 * why via a corpus-wide finding — never silently returns an empty list that
 * would read as "no duplicates found" when the real answer is "not checked".
 */
export declare function findMergeCandidatesGuarded(files: {
    path: string;
    content: string;
}[], embed: (text: string) => number[] | Promise<number[]>, chunkFn: (path: string, content: string) => Chunk[] | Promise<Chunk[]>, maxFiles: number): Promise<{
    mergeCandidates: MergeCandidate[];
    findings: LintFinding[];
}>;
