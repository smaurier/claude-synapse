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
import { type SynapseDoctorReport } from "./synapseDoctor.js";
export interface RefreshIndexResult {
    auditTriggered: boolean;
    auditReport?: SynapseDoctorReport;
}
export declare function isAuditOverdue(lastAuditAt: string | null, cadenceDays: number): boolean;
export declare function runRefreshIndex(pluginDataDir: string, projectDir?: string): Promise<RefreshIndexResult>;
