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
 *
 * Also implements problème 5's daemon-less periodic trigger: checks
 * SharedConfig.lastAuditAt against auditCadenceDays and runs
 * /synapse-doctor automatically when overdue — the mechanism was designed
 * (13/08) but nothing ever actually performed the audit or advanced the
 * timestamp until this. Only runs when projectDir is given (need it to
 * derive linkPath for the doctor run).
 *
 * Records this machine in the device registry (16/08, SharedConfig.
 * knownMachines) unconditionally — every SessionStart, not gated on
 * projectDir, since presence tracking doesn't need a project context.
 */

import { readLocalConfig, defaultLocalConfigPath, readSharedConfig, recordMachineSeen } from "../config/config.js";
import { refreshHubIndex } from "../rag/searchHub.js";
import { ensureCurrentProjectLinked, projectMemoryLinkPath } from "./refreshProjects.js";
import { runSynapseDoctor, type SynapseDoctorReport } from "./synapseDoctor.js";

export interface RefreshIndexResult {
  auditTriggered: boolean;
  auditReport?: SynapseDoctorReport;
}

export function isAuditOverdue(lastAuditAt: string | null, cadenceDays: number): boolean {
  if (!lastAuditAt) return true; // never audited — overdue by definition, catches up immediately
  const last = new Date(lastAuditAt);
  if (Number.isNaN(last.getTime())) return true;
  return Date.now() - last.getTime() > cadenceDays * 24 * 60 * 60 * 1000;
}

export async function runRefreshIndex(pluginDataDir: string, projectDir?: string): Promise<RefreshIndexResult> {
  const localConfig = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
  recordMachineSeen(localConfig.hubClonePath, localConfig.machineId);
  if (projectDir) {
    ensureCurrentProjectLinked(projectDir, localConfig.hubClonePath);
  }
  await refreshHubIndex(localConfig.hubClonePath);

  if (!projectDir) return { auditTriggered: false };

  const shared = readSharedConfig(localConfig.hubClonePath);
  if (!isAuditOverdue(shared.lastAuditAt, shared.auditCadenceDays)) {
    return { auditTriggered: false };
  }

  const auditReport = await runSynapseDoctor(pluginDataDir, projectMemoryLinkPath(projectDir));
  return { auditTriggered: true, auditReport };
}
