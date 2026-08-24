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
import { type HybridResult } from "../rag/hybridSearch.js";
export declare function shouldSkip(prompt: string): boolean;
export declare function filterAndFormatResults(results: HybridResult[]): string | null;
export declare function runProactiveRecall(pluginDataDir: string, prompt: string): Promise<Record<string, string>>;
