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

import { loadCorpus } from "./corpus.js";
import { searchHub } from "./searchHub.js";
import { extractFrontmatter } from "../commands/brainLint.js";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findExactMatches(corpus: { path: string; content: string }[], query: string): string[] {
  const needle = query.trim();
  if (!needle) return [];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(needle)}(?![\\p{L}\\p{N}_])`, "iu");
  return corpus.filter((f) => pattern.test(f.content)).map((f) => f.path);
}

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
 * `superseded_by_map`, refined by Sylvain): `metadata.superseded_by:
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
export function applySupersession(results: HybridResult[], corpus: { path: string; content: string }[]): HybridResult[] {
  const corpusPaths = new Set(corpus.map((f) => f.path));
  const byPath = new Map(corpus.map((f) => [f.path, f.content]));

  const annotated = results.map((r): HybridResult => {
    const content = byPath.get(r.path);
    const supersededBy = content ? extractFrontmatter(content)?.fields["metadata.superseded_by"] : undefined;
    return supersededBy && corpusPaths.has(supersededBy) ? { ...r, supersededBy } : r;
  });

  // Stable-ish partition: superseded entries sink after the entry they
  // name (or after everything else, if that entry isn't in this result
  // set) — plain results keep their original relative order.
  const superseded = annotated.filter((r) => r.supersededBy);
  const rest = annotated.filter((r) => !r.supersededBy);
  return [...rest, ...superseded];
}

/**
 * Exact matches are always included and ranked first (matchType: "exact",
 * score fixed at 1 — a placeholder, not a real similarity, never compared
 * numerically against semantic scores in the UI). Semantic results fill
 * the rest of topK, skipping anything already found exactly to avoid
 * showing the same file twice.
 */
export async function hybridSearchHub(hubClonePath: string, query: string, topK = 10): Promise<HybridResult[]> {
  const corpus = loadCorpus(hubClonePath);
  const exactPaths = findExactMatches(corpus, query);
  const exactSet = new Set(exactPaths);

  const semanticResults = await searchHub(hubClonePath, query, topK);

  const merged: HybridResult[] = [
    ...exactPaths.map((path): HybridResult => ({ path, score: 1, matchType: "exact" })),
    ...semanticResults.filter((r) => !exactSet.has(r.path)).map((r): HybridResult => ({ ...r, matchType: "semantic" })),
  ];

  return applySupersession(merged, corpus).slice(0, topK);
}
