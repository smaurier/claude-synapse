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
 * WIP limiter (périmètre IN) — counts `project`-type memories that carry a
 * deadline still ahead of them, and flags it as a single corpus-wide finding
 * if over the limit. Deliberately a count, not a judgment call about which
 * projects to close — that's for the user.
 *
 * Backlog item 41 (13/10/2026): it used to count every project that wasn't
 * demonstrably finished, which on a real hub read "109 mémoires project
 * actives (limite indicative : 5)" followed by all 109 paths. Unreadable,
 * therefore unactionable, and measuring three different things at once: 52
 * `ongoing` (permanent by design, they will never be closed), 38 with no
 * `expires` at all, 19 with a real future deadline. Proof that the number
 * said nothing: closing 10 fiches did not move it by a single unit, while
 * flipping 3 dormant fiches to `ongoing` took it from 106 to 109 — and a
 * limit of 5 is unreachable by construction while the 52 permanent ones are
 * in the count. Only dated deadlines count now; the other populations are
 * named in the message, and "project without `expires`" is a convention
 * defect already reported per-file by lintFile, not a workload.
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
/**
 * Backlog item 39 (13/10/2026, measured 15/10): the frontmatter is stripped
 * before a file is compared to another, because it is the single biggest
 * source of false positives. On the real 222-fiche hub, 59 pairs came back
 * at 0.85 and 47 of them were feedback<->feedback: those fiches share a
 * frontmatter block (name / description / metadata.type / created / expires)
 * and a writing template, and the frontmatter dominates the first chunk of
 * every one of them. The similarity was measuring the register, not the
 * subject. Dropping it takes those 47 to 0.
 *
 * Only this check strips it. The RAG index keeps embedding whole files on
 * purpose — searching for "the fiche about X" legitimately matches on the
 * description — and the two must never share a transformed embedding space
 * (same reasoning as the chunker note above).
 */
export declare function bodyWithoutFrontmatter(content: string): string;
export declare function findMergeCandidates(files: {
    path: string;
    content: string;
}[], embed: (text: string) => number[] | Promise<number[]>, chunkFn?: (path: string, content: string) => Chunk[] | Promise<Chunk[]>, threshold?: number): Promise<MergeCandidate[]>;
/**
 * The size-guarded entrypoint real callers use instead of findMergeCandidates
 * directly. Above maxFiles, skips the O(n²) comparison entirely and reports
 * why via a corpus-wide finding — never silently returns an empty list that
 * would read as "no duplicates found" when the real answer is "not checked".
 *
 * Backlog item 39, second half: the ranked cap lives here, not in
 * findMergeCandidates, for the same reason the size guard does. The pure
 * algorithm must never silently drop a result it found; the application layer
 * decides how many suggestions a human can actually act on, and says out loud
 * how many it held back. 59 suggestions is not a list anyone reads, so the
 * cap is what keeps the report readable as the corpus grows, rather than
 * leaving it readable by luck.
 */
export declare function findMergeCandidatesGuarded(files: {
    path: string;
    content: string;
}[], embed: (text: string) => number[] | Promise<number[]>, chunkFn: (path: string, content: string) => Chunk[] | Promise<Chunk[]>, maxFiles: number, maxSuggestions?: number): Promise<{
    mergeCandidates: MergeCandidate[];
    findings: LintFinding[];
}>;
