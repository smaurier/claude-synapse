/**
 * The CLI-facing entrypoint for the SessionStart refresh hook — resolves
 * LocalConfig the same way brainSearch.ts does, then delegates to
 * refreshHubIndex(). Kept separate from brainSearch.ts because the hook
 * that calls this never needs search results, only the "index is current"
 * side effect (see rebuildIfStale's staleness check, problème 4/5).
 */

import { readLocalConfig, defaultLocalConfigPath } from "../config/config.js";
import { refreshHubIndex } from "../rag/searchHub.js";

export async function runRefreshIndex(pluginDataDir: string): Promise<void> {
  const localConfig = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
  await refreshHubIndex(localConfig.hubClonePath);
}
