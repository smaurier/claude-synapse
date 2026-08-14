/**
 * The CLI-facing entrypoint for the SessionStart refresh hook — resolves
 * LocalConfig the same way brainSearch.ts does, then delegates to
 * refreshHubIndex(). Kept separate from brainSearch.ts because the hook
 * that calls this never needs search results, only the "index is current"
 * side effect (see rebuildIfStale's staleness check, problème 4/5).
 *
 * projectDir is optional (added 14/08, problème 6): when given, also
 * ensures the CURRENT project is linked to the hub — "zero action
 * utilisateur" per the multi-slug design, cheap enough to check every
 * session. Optional rather than required so this stays backward
 * compatible with callers that only care about the index refresh.
 */

import { readLocalConfig, defaultLocalConfigPath } from "../config/config.js";
import { refreshHubIndex } from "../rag/searchHub.js";
import { ensureCurrentProjectLinked } from "./refreshProjects.js";

export async function runRefreshIndex(pluginDataDir: string, projectDir?: string): Promise<void> {
  const localConfig = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
  if (projectDir) {
    ensureCurrentProjectLinked(projectDir, localConfig.hubClonePath);
  }
  await refreshHubIndex(localConfig.hubClonePath);
}
