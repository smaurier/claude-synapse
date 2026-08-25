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
 * French-only by design (this hub's language). Whole-file scan, not
 * chunk-level: at file granularity, matching on ordinary negation
 * ("ne pas", "pas de", "jamais", "attendre") turned out to fire on 9-10 of
 * 10 real candidates in a real test against a real hub — every file of any
 * length contains *some* ordinary negation somewhere, so that list carried
 * no signal at all, not just more false positives than desired. Narrowed
 * to the two markers that actually discriminated on that same test data
 * (4 of 10 flagged, correctly including the two files with the guard-rail
 * genuinely relevant to the query): the ⛔ convention marker, and
 * "interdit" (rare enough in ordinary prose to stay meaningful). A
 * chunk-level version — flagging negation only in the specific passage
 * that scored semantically relevant, rather than anywhere in the whole
 * file — would let the broader marker list (ne pas/pas de/jamais/attendre)
 * work as originally scoped, but needs the chunk text plumbed back through
 * hybridSearchHub (currently collapses to file-level {path, score} before
 * reaching this module) — real follow-up, not attempted tonight to avoid
 * touching the RAG pipeline shared with /brain-search under time pressure.
 */
const NEGATION_MARKERS = [/⛔/u, /\binterdit/iu];
export function hasNegationMarker(content) {
    return NEGATION_MARKERS.some((re) => re.test(content));
}
/** Checked against the raw candidate set (before filterAndFormatResults'
 *  MIN_SCORE gate) — deliberately not the same input, see module doc. */
export function formatContradictionWarnings(results, corpusByPath) {
    const flagged = results.filter((r) => {
        const content = corpusByPath.get(r.path);
        return content !== undefined && hasNegationMarker(content);
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