/**
 * /synapse-doctor (périmètre IN) — unifies /brain-status, /brain-lint, and
 * the health-checks for problèmes 1/4/5/6 into one periodic report.
 * Report-only, except two auto-actions already decided as safe in the
 * design: a broken link gets recreated (never a wrong-target one — that
 * could silently repoint memory at the wrong hub, worth a human look), and
 * every remembered refreshProjectsRoots entry gets re-scanned (16/08 —
 * previously this needed a root directory the command didn't take; now it
 * reads whatever /synapse-refresh-projects has remembered, same daemon-less
 * pattern as the audit-cadence mechanism below). ensureCurrentProjectLinked
 * (SessionStart) still covers any project the user actually opens a
 * session in — this covers the complementary case, projects that predate
 * Synapse being set up at all.
 *
 * Updates SharedConfig.lastAuditAt after running — this IS the daemon-less
 * mechanism from problème 5 (last_audit_at checked at SessionStart,
 * declenché si le délai est dépassé): /synapse-doctor is what actually
 * performs the audit that mechanism schedules, previously undecided how
 * the timestamp itself would get updated.
 */
import { type LinkState } from "../jonction/jonction.js";
import { type LintFinding, type MergeCandidate } from "./brainLint.js";
import { type RefreshProjectsResult } from "./refreshProjects.js";
export interface SynapseDoctorReport {
    hubClonePath: string;
    linkState: LinkState;
    linkAutoFixed: boolean;
    fileCount: number;
    findings: LintFinding[];
    mergeCandidates: MergeCandidate[];
    projectsRelinked: RefreshProjectsResult[];
    /** machineId -> ISO last-seen timestamp (SharedConfig.knownMachines,
     *  16/08) — the device registry, updated on every SessionStart. */
    knownMachines: Record<string, string>;
}
export declare function runSynapseDoctor(pluginDataDir: string, linkPath: string): Promise<SynapseDoctorReport>;
