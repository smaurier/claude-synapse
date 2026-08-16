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
 *
 * Persists rootDir into SharedConfig.refreshProjectsRoots (16/08, problème 6
 * follow-up): a project tree scanned manually once this way gets picked up
 * automatically by every later periodic audit (synapseDoctor.ts) too — the
 * complementary case to ensureCurrentProjectLinked, which only ever covers
 * a project the user has actually opened a session in. Locked like any
 * other shared-config write (bootstrap.ts, setSynapseConfig).
 */

import { readLocalConfig, defaultLocalConfigPath, readSharedConfig, writeSharedConfig, DEFAULT_SHARED_CONFIG } from "../config/config.js";
import { acquireLock, releaseLock } from "../lock/lock.js";
import { refreshProjects, type RefreshProjectsResult } from "./refreshProjects.js";

function rememberRoot(hubClonePath: string, machineId: string, rootDir: string): void {
  const lockResult = acquireLock(hubClonePath, machineId, DEFAULT_SHARED_CONFIG.lockTimeoutMinutes);
  if (!lockResult.acquired) return; // best-effort: another machine mid-write, not worth failing the scan over
  try {
    const shared = readSharedConfig(hubClonePath);
    if (!shared.refreshProjectsRoots.includes(rootDir)) {
      writeSharedConfig(hubClonePath, { ...shared, refreshProjectsRoots: [...shared.refreshProjectsRoots, rootDir] });
    }
  } finally {
    releaseLock(hubClonePath, machineId);
  }
}

export async function runRefreshProjects(pluginDataDir: string, rootDir: string): Promise<RefreshProjectsResult[]> {
  const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
  const shared = readSharedConfig(local.hubClonePath);
  const results = refreshProjects(rootDir, local.hubClonePath, shared.refreshProjectsExclusions);
  rememberRoot(local.hubClonePath, local.machineId, rootDir);
  return results;
}
