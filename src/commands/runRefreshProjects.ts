/**
 * The CLI-facing entrypoint for a manual multi-root refresh-projects scan —
 * the piece that was missing entirely: refreshProjects() (the scanner)
 * existed and was tested since problème 6's implementation, but nothing
 * ever actually called it with real config/exclusions. ensureCurrentProjectLinked
 * (wired into SessionStart) only ever covers ONE project at a time.
 *
 * Exclusion format decided 14/08: exact top-level directory names under
 * rootDir — matches refreshProjects()'s own scan granularity (readdirSync,
 * not recursive), so no glob-matching library is needed for this.
 */

import { readLocalConfig, defaultLocalConfigPath, readSharedConfig } from "../config/config.js";
import { refreshProjects, type RefreshProjectsResult } from "./refreshProjects.js";

export async function runRefreshProjects(pluginDataDir: string, rootDir: string): Promise<RefreshProjectsResult[]> {
  const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
  const shared = readSharedConfig(local.hubClonePath);
  return refreshProjects(rootDir, local.hubClonePath, shared.refreshProjectsExclusions);
}
