/**
 * The CLI-facing entrypoint for /brain-search — resolves LocalConfig from
 * the plugin's per-machine data directory, then delegates to searchHub.ts.
 *
 * pluginDataDir is taken as a parameter, never read from
 * process.env.CLAUDE_PLUGIN_DATA here: per the packaging decision (14/08),
 * the real invocation (skills/brain-search/SKILL.md) substitutes
 * ${CLAUDE_PLUGIN_DATA} directly into the command text and passes it as an
 * explicit CLI argument — env var inheritance into a skill-launched Bash
 * process isn't documented, so nothing in this module depends on it.
 */

import { readLocalConfig, defaultLocalConfigPath } from "../config/config.js";
import { searchHub } from "../rag/searchHub.js";
import type { SearchResult } from "../rag/store.js";

export async function runBrainSearch(pluginDataDir: string, query: string, topK = 10): Promise<SearchResult[]> {
  const localConfig = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
  return searchHub(localConfig.hubClonePath, query, topK);
}
