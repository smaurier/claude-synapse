/**
 * The CLI-facing entrypoint for /brain-search — resolves LocalConfig from
 * the plugin's per-machine data directory, then delegates to
 * hybridSearchHub.ts (semantic + lexical fallback, added 14/08 after the
 * real-hub test found a bare acronym query — "LEP" — missed by pure
 * semantic search despite appearing verbatim in the target file; see
 * hybridSearch.ts for the full reasoning).
 *
 * pluginDataDir is taken as a parameter, never read from
 * process.env.CLAUDE_PLUGIN_DATA here: per the packaging decision (14/08),
 * the real invocation (skills/brain-search/SKILL.md) substitutes
 * ${CLAUDE_PLUGIN_DATA} directly into the command text and passes it as an
 * explicit CLI argument — env var inheritance into a skill-launched Bash
 * process isn't documented, so nothing in this module depends on it.
 */

import { readLocalConfig, defaultLocalConfigPath } from "../config/config.js";
import { hybridSearchHub, type HybridResult } from "../rag/hybridSearch.js";

export async function runBrainSearch(pluginDataDir: string, query: string, topK = 10): Promise<HybridResult[]> {
  const localConfig = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
  return hybridSearchHub(localConfig.hubClonePath, query, topK);
}

/**
 * Found 16/08 by manual testing on a disposable hub, not by guessing:
 * applySupersession() (hybridSearch.ts) correctly de-ranks an outdated
 * memory, but a superseded result and its replacement printed with the
 * exact same label — nothing told a reader which of the two is current.
 * This is what actually surfaces `supersededBy` to output; kept here
 * (tested) rather than inlined in brainSearchCli.ts (argv/print shim,
 * not unit-tested, same convention as every other *Cli.ts).
 */
export function formatSearchResult(r: HybridResult): string {
  const label = r.matchType === "exact" ? "correspondance exacte" : r.score.toFixed(3);
  const suffix = r.supersededBy ? `  [remplacé par : ${r.supersededBy}]` : "";
  return `${label}  ${r.path}${suffix}`;
}
