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
 *
 * Backlog item 49 (16/10/2026) : contribue aussi les signalements de
 * `dependencyAudit.ts` (vulnérabilités npm et dépendances obsolètes du
 * plugin lui-même) — c'est ici que l'audit périodique existant devient
 * l'endroit naturel où brancher cette vérification, plutôt que d'inventer un
 * second mécanisme de cadence. `pluginRoot` est un paramètre OBLIGATOIRE,
 * pas optionnel : un garde optionnel est un garde qui pourrit — exactement
 * la même objection déjà tranchée sur `embedderIdentity` dans
 * `rebuildIfStale`. Un troisième paramètre optionnel qu'un refactor futur
 * oublie de passer à un appel fait taire ce check pour toujours, sans
 * aucun signal — précisément le mode de panne que cet item devait éviter.
 * `collectDependencyFindings` reste fail-silent sur ses échecs internes
 * (npm absent, réseau, JSON invalide) ; ce n'est pas la même chose que
 * rendre sa propre invocation optionnelle ici.
 */
import { type LinkState } from "../jonction/jonction.js";
import { type LintFinding, type DuplicateCandidate } from "./brainLint.js";
import { type RefreshProjectsResult } from "./refreshProjects.js";
export interface SynapseDoctorReport {
    hubClonePath: string;
    linkState: LinkState;
    linkAutoFixed: boolean;
    fileCount: number;
    findings: LintFinding[];
    duplicateCandidates: DuplicateCandidate[];
    projectsRelinked: RefreshProjectsResult[];
    /** machineId -> ISO last-seen timestamp (SharedConfig.knownMachines,
     *  16/08) — the device registry, updated on every SessionStart. */
    knownMachines: Record<string, string>;
}
export declare function runSynapseDoctor(pluginDataDir: string, linkPath: string, pluginRoot: string): Promise<SynapseDoctorReport>;
