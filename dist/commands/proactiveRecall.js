/**
 * Proactively surfaces relevant hub memories before Claude generates a
 * response (UserPromptSubmit hook). Same fail-silent posture as every
 * other hook command: any missing config, absent hub, or scoring that
 * returns nothing degrades to an empty output — never an error that
 * blocks the session.
 *
 * Design choices fixed here rather than left configurable:
 *  - MIN_SCORE 0.45 : measured on a real hub (14/08 calibration run,
 *    same session that found "LEP" missed by pure semantic search) —
 *    below this, results were consistently off-topic on that corpus.
 *  - MAX_RESULTS 5 : inject at most 5 paths; more fragments context
 *    without adding signal when scores are already weak.
 *  - MIN_PROMPT_WORDS 5 : bare acronyms ("RGAA", "LEP") are handled
 *    better by /brain-search (explicit, user-driven) than by a silent
 *    pre-inject — short prompts correlate with navigation commands
 *    and skill invocations, not content questions.
 *
 * Exact matches (findExactMatches inside hybridSearchHub) are always
 * kept regardless of score: a literal hit in the corpus is signal the
 * semantic model might miss on short or domain-specific terms.
 */
import { readLocalConfig, defaultLocalConfigPath } from "../config/config.js";
import { hybridSearchHub } from "../rag/hybridSearch.js";
import { loadHubCorpus } from "../rag/corpus.js";
import { chunkFile } from "../rag/chunk.js";
const MIN_SCORE = 0.45;
const MAX_RESULTS = 5;
const MIN_PROMPT_WORDS = 5;
/**
 * Détecteur de contradictions (backlog #28, 24/08) — v1 large. The 10/08
 * incident this responds to wasn't a retrieval failure: the memory that
 * contradicted the advice given (a career guard-rail) was already loaded in
 * context that day. It was an attention failure — the fragment that
 * contradicted the thesis got read and deprioritized among everything else
 * recalled. A detector limited to already-⛔-tagged lines wouldn't have
 * caught it either (that guard-rail *was* already tagged) — the actual gap
 * is making prohibition language visually impossible to skim past, not
 * finding it (finding already works). Hence: scan raw candidate content for
 * negation/prohibition phrasing, independent of the relevance score used
 * for the ordinary recall section below — a real constraint shouldn't be
 * missed just because this particular phrasing of the prompt scored it low.
 *
 * French-only by design (this hub's language). Two tiers, not one — each
 * covers a failure mode the other doesn't:
 *
 * 1. STRICT_MARKERS, checked against the WHOLE file: ⛔ and "interdit" only.
 *    Proven on a real hub (24/08) to discriminate correctly at file
 *    granularity (4 of 10 real candidates flagged, correctly including the
 *    file with the guard-rail actually relevant to the test query) — no
 *    chunk-plumbing needed for these two, they're rare enough in ordinary
 *    prose to stay meaningful even scanned over an entire long file.
 * 2. BROAD_MARKERS ("ne pas", "pas de", "jamais", "attendre"), checked ONLY
 *    against the specific chunk that matched the query (chunkId, from
 *    search.ts's brainSearch via hybridSearchHub) — these fire on 9-10 of
 *    10 real files at whole-file granularity (too common in ordinary French
 *    prose to mean anything at that scope), but stay useful once scoped to
 *    just the ~500-char passage that was actually semantically relevant.
 *
 * Both tiers run, result is the union — NOT "chunk replaces whole-file".
 * Tried chunk-scoping as a strict replacement first and found it regresses
 * recall: the single best-scoring chunk for a query is not always the
 * chunk that contains the file's actual guard-rail (a 25KB file can easily
 * have its constraint in a different paragraph than whatever else in it
 * happened to score highest for this specific prompt) — on the same real
 * test, chunk-only-scoping silently dropped the one true positive
 * (`project_career.md`) that whole-file/STRICT_MARKERS correctly caught.
 * Since a missed constraint is explicitly worse than a noisy warning here
 * (see module doc), STRICT_MARKERS keeps running at whole-file scope as a
 * safety net; BROAD_MARKERS only adds sensitivity on top of it, scoped
 * narrowly enough (one chunk) to not reintroduce the original noise.
 */
const STRICT_MARKERS = [/⛔/u, /\binterdit/iu];
const BROAD_MARKERS = [
    /\bne\s+(?:\p{L}+\s+)?pas\b/iu, // "ne pas", "ne faut pas", "n'est pas"
    /\bpas\s+d[e']/iu, // "pas de suivi", "pas d'avance"
    /\bjamais\b/iu,
    /\battendre\b/iu,
];
export function hasStrictNegationMarker(content) {
    return STRICT_MARKERS.some((re) => re.test(content));
}
/** Only meaningful when checked against a chunk-scoped passage, not a whole
 *  file — see the module doc. */
export function hasBroadNegationMarker(content) {
    return BROAD_MARKERS.some((re) => re.test(content));
}
/** Isolates just the chunk that actually matched (chunkId, from
 *  hybridSearchHub — see search.ts's brainSearch), instead of scanning an
 *  entire file. Re-chunks at call time rather than persisting chunk text in
 *  the vector store (chunkFile is a pure, deterministic function of
 *  path+content — cheap to recompute, and avoids growing the store's
 *  on-disk format for a single caller's need). Falls back to the whole
 *  content when there's no chunkId (exact matches) or it doesn't match any
 *  real chunk (defensive — should not normally happen). */
export function extractChunkText(sourcePath, content, chunkId) {
    if (!chunkId)
        return content;
    const match = chunkFile(sourcePath, content).find((c) => c.chunkId === chunkId);
    return match ? match.text : content;
}
/** Checked against the raw candidate set (before filterAndFormatResults'
 *  MIN_SCORE gate) — deliberately not the same input, see module doc.
 *  Scoped to each result's matching chunk (via chunkId), not the whole
 *  file — see extractChunkText and the module doc's note on why a
 *  whole-file scan turned out to carry no signal on a real hub. */
export function formatContradictionWarnings(results, corpusByPath) {
    const flagged = results.filter((r) => {
        const content = corpusByPath.get(r.path);
        if (content === undefined)
            return false;
        // STRICT: whole-file safety net, proven low-noise at that scope.
        if (hasStrictNegationMarker(content))
            return true;
        // BROAD: only the specific chunk that matched — see module doc.
        return hasBroadNegationMarker(extractChunkText(r.path, content, r.chunkId));
    });
    if (flagged.length === 0)
        return null;
    const lines = flagged.map((r) => `- ${r.path}`);
    return `## ⚠️ Synapse — contrainte potentielle (vérifier avant de conseiller)\n\n${lines.join("\n")}`;
}
export function shouldSkip(prompt) {
    return prompt.trim().split(/\s+/).filter(Boolean).length < MIN_PROMPT_WORDS;
}
export function filterAndFormatResults(results) {
    const relevant = results
        .filter((r) => r.matchType === "exact" || r.score >= MIN_SCORE)
        .slice(0, MAX_RESULTS);
    if (relevant.length === 0)
        return null;
    const lines = relevant.map((r) => {
        const label = r.matchType === "exact" ? "exact" : r.score.toFixed(3);
        return `- ${r.path} (${label})`;
    });
    return `## Synapse — relevant memories\n\n${lines.join("\n")}`;
}
export async function runProactiveRecall(pluginDataDir, prompt) {
    if (shouldSkip(prompt))
        return {};
    const localConfig = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
    const results = await hybridSearchHub(localConfig.hubClonePath, prompt, MAX_RESULTS * 2);
    const corpus = loadHubCorpus(localConfig.hubClonePath);
    const corpusByPath = new Map(corpus.map((f) => [f.path, f.content]));
    // Contradiction warnings are checked against the full raw candidate set,
    // not the MIN_SCORE-filtered one below — see formatContradictionWarnings.
    const warnings = formatContradictionWarnings(results, corpusByPath);
    const context = filterAndFormatResults(results);
    const sections = [warnings, context].filter((s) => s !== null);
    if (sections.length === 0)
        return {};
    return { additionalContext: sections.join("\n\n") };
}
//# sourceMappingURL=proactiveRecall.js.map