/**
 * Lexical fallback (backlog item since 14/08, validated empirically the
 * same day): a bare acronym or short term embeds poorly regardless of
 * model — measured on the real corpus, "LEP" alone missed the file that
 * literally contains "LEP (10k€) intouchable", while "épargne populaire"
 * (the same concept spelled out) found it at rank 2. This is a known,
 * general limitation of embedding models with short/context-free queries,
 * not specific to the model chosen here.
 *
 * findExactMatches is deliberately simple: a case-insensitive, WORD-
 * BOUNDARY-aware check of the whole trimmed query against each file's raw
 * content. It does NOT tokenize or match individual words — a multi-word
 * natural question ("quelle est la contrainte sur le LEP") won't literally
 * appear in anyone's notes, so it correctly contributes nothing there;
 * semantic search carries that case. This is specifically the backstop for
 * exact terms (acronyms, project names, IDs) users search with the same
 * words their notes already use.
 *
 * Word boundaries matter more than they first look: a first version used a
 * plain substring check and, tested against the real hub the same day,
 * matched "LEP" inside "FilePath" (a PowerShell command) and
 * "compileProgressStore" (a code identifier) — real false positives, not a
 * hypothetical. `\p{L}\p{N}_` (Unicode-aware) rather than `\w` so accented
 * French words on either side of a match are still treated as "part of a
 * word", not silently ASCII-only.
 */
export declare function findExactMatches(corpus: {
    path: string;
    content: string;
}[], query: string): string[];
export interface HybridResult {
    path: string;
    score: number;
    matchType: "exact" | "semantic";
    /** Set when this file's frontmatter names a `superseded_by:` target that
     *  actually exists in the corpus — the path of the version that replaces
     *  it. Never removes the result; see applySupersession(). */
    supersededBy?: string;
}
/**
 * Supersession (backlog 16/08, étude de marché Synapse — agentic-stack's
 * `superseded_by_map`, refined after review): `metadata.superseded_by:
 * <path>` on a memory marks it as replaced by another, specific memory —
 * NOT "this project is closed" (that's the existing `expires` convention,
 * which already keeps closed memories fully searchable as a documentary
 * base — never conflate the two). The point is narrower: when two files
 * would otherwise both surface for the same query, make it unambiguous
 * which one is the current truth, without hiding the other — a corrected
 * rule and its outdated predecessor should never look equally "current"
 * in a result list.
 *
 * Deliberately reorders rather than filters: the superseded file is moved
 * after the version that replaces it (when that version is also in the
 * results — nothing to reorder against otherwise, so it stays in place)
 * and annotated with `supersededBy`, but it is never dropped. A dangling
 * `superseded_by` (target not present anywhere in the corpus) is brain-
 * lint's job to flag as a finding — search silently ignores it rather than
 * annotating a link to nothing.
 */
export declare function applySupersession(results: HybridResult[], corpus: {
    path: string;
    content: string;
}[]): HybridResult[];
/**
 * Exact matches are always included and ranked first (matchType: "exact",
 * score fixed at 1 — a placeholder, not a real similarity, never compared
 * numerically against semantic scores in the UI). Semantic results fill
 * the rest of topK, skipping anything already found exactly to avoid
 * showing the same file twice.
 */
export declare function hybridSearchHub(hubClonePath: string, query: string, topK?: number): Promise<HybridResult[]>;
