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

  return merged.slice(0, topK);
}
