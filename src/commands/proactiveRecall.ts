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
import { hybridSearchHub, type HybridResult } from "../rag/hybridSearch.js";

const MIN_SCORE = 0.45;
const MAX_RESULTS = 5;
const MIN_PROMPT_WORDS = 5;

export function shouldSkip(prompt: string): boolean {
  return prompt.trim().split(/\s+/).filter(Boolean).length < MIN_PROMPT_WORDS;
}

export function filterAndFormatResults(results: HybridResult[]): string | null {
  const relevant = results
    .filter((r) => r.matchType === "exact" || r.score >= MIN_SCORE)
    .slice(0, MAX_RESULTS);
  if (relevant.length === 0) return null;
  const lines = relevant.map((r) => {
    const label = r.matchType === "exact" ? "exact" : r.score.toFixed(3);
    return `- ${r.path} (${label})`;
  });
  return `## Synapse — relevant memories\n\n${lines.join("\n")}`;
}

export async function runProactiveRecall(pluginDataDir: string, prompt: string): Promise<Record<string, string>> {
  if (shouldSkip(prompt)) return {};
  const localConfig = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
  const results = await hybridSearchHub(localConfig.hubClonePath, prompt, MAX_RESULTS * 2);
  const context = filterAndFormatResults(results);
  if (!context) return {};
  return { additionalContext: context };
}
