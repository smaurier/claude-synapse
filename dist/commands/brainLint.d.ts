/**
 * /brain-lint (périmètre IN) — reports only, never auto-fixes or
 * auto-executes anything (a merge/split/deletion suggestion acted on
 * automatically could conflate two distinct facts in silence, worse than
 * a stale link — see project memory's own reasoning for this). Frontmatter
 * validation needs no YAML library: the convention used is a flat 2-level
 * structure (top-level keys + one nesting level under `metadata:`), simple
 * enough to hand-parse without pulling in a dependency (léger bias).
 */
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
/** Les quatre types de la convention mémoire. Seule déclaration : `SLUG_TYPE_PREFIXES`
 *  en dérive plus bas, pour qu'un cinquième type ajouté ici ne laisse pas la
 *  règle de collision de slug aveugle à son existence. */
/** Gelé : la liste est devenue publique pour que `SLUG_TYPE_PREFIXES` en
 *  dérive au lieu de la recopier, et une liste publique mutable laisserait
 *  n'importe quel appelant redéfinir la convention de nommage à l'exécution.
 *  L'ordre n'est pas porteur aujourd'hui car aucun type n'est préfixe d'un
 *  autre ; ajouter un type comme `project_archive` rendrait l'ordre
 *  d'insertion significatif dans `slugStem`. */
export declare const VALID_TYPES: readonly string[];
/** One file's checks — frontmatter validity, expiry, and the two
 *  structural heuristics. Pure, fast, no model needed. */
export declare function lintFile(path: string, content: string, today?: Date): LintFinding[];
/**
 * Backlog item 37 (13/10/2026): the index (`MEMORY.md`) and its sub-indexes
 * (`MEMORY-dormant.md`, ...) are a table of contents, not memories — they
 * carry no frontmatter by convention. Linting them as memories produced the
 * single `[error]` of a 257-line report on a real hub, and that one fake
 * error masked the fact that no memory in the corpus had a real one.
 * Matched on the basename, so a nested index is covered too: the uppercase
 * spelling is the convention and memory slugs are lowercase kebab-case, so
 * a real memory never collides with it.
 */
export declare function isIndexFile(path: string): boolean;
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
/**
 * Backlog item 38 (13/10/2026): nothing verified the index's own links, nor the
 * reverse — a fiche silently absent from every index. Measured by hand that day:
 * 187 links cited, 0 broken, 1 orphan — a clean result, but guaranteed by nothing;
 * the next fiche created without an index line would never be caught. Two
 * findings, scoped deliberately to the index's markdown links only (not every
 * `[[wikilink]]` in every fiche's body, a much noisier and differently-scoped
 * question): a link cited with no matching file, and a real fiche cited by no
 * index file at all.
 */
export declare function checkIndexLinks(files: {
    path: string;
    content: string;
}[]): LintFinding[];
/**
 * Backlog item 36 (13/10/2026): `MEMORY.md` is the one file paid at EVERY
 * `SessionStart`, regardless of topic — and nothing measured its weight or
 * how it breaks down by section. Scoped deliberately to `MEMORY.md` itself,
 * not the `MEMORY-*.md` sub-indexes (those are loaded on demand by the hub's
 * own convention, not paid on every session — item 37 already draws this
 * same line between "the index" and "a memory"). `indexMaxBytes` is the one
 * configurable threshold, same pattern as `wipLimit`: it gates the whole
 * finding, and once past it the message lists every `##` section by weight,
 * heaviest first, so the next person reading the report knows exactly where
 * the bytes are going rather than just that there are too many of them.
 */
export declare function checkIndexWeight(files: {
    path: string;
    content: string;
}[], indexMaxBytes: number): LintFinding[];
