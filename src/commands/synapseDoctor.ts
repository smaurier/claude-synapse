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

import { readLocalConfig, defaultLocalConfigPath, readSharedConfig, writeSharedConfig, recordMachineSeen, DEFAULT_SHARED_CONFIG } from "../config/config.js";
import { acquireLock, releaseLock } from "../lock/lock.js";
import { loadHubCorpus } from "../rag/corpus.js";
import { inspectLink, createLink, removeLink, type LinkState } from "../jonction/jonction.js";
import { lintCorpus, findDuplicateCandidates, checkWipLimit, checkSupersessionReferences, type LintFinding, type DuplicateCandidate } from "./brainLint.js";
import { checkCitedCodeDrift, createGitLastCommitDateResolver } from "./citedCodeDrift.js";
import { collectDependencyFindings } from "./dependencyAudit.js";
import { refreshProjects, type RefreshProjectsResult } from "./refreshProjects.js";

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

export async function runSynapseDoctor(pluginDataDir: string, linkPath: string, pluginRoot: string): Promise<SynapseDoctorReport> {
  const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
  recordMachineSeen(local.hubClonePath, local.machineId);

  // Problème 1 health-check: a broken link is the one case safe to
  // auto-fix (per design) — wrong-target is left alone, that's a human
  // decision (could mean the hub itself was reconfigured on purpose).
  let linkState = inspectLink(linkPath, local.hubClonePath);
  let linkAutoFixed = false;
  if (linkState === "broken") {
    // A dangling symlink still occupies linkPath as a real fs entry —
    // createLink() alone would fail with EEXIST. Same removeLink-then-
    // createLink sequence ensureHubLink() uses for this exact state.
    removeLink(linkPath);
    createLink(local.hubClonePath, linkPath);
    linkState = inspectLink(linkPath, local.hubClonePath);
    linkAutoFixed = true;
  }

  // Problème 4 health-check + /brain-lint, in one corpus load. wipLimit
  // read unlocked (a read, not a write) — the lock below only guards the
  // lastAuditAt write.
  const corpus = loadHubCorpus(local.hubClonePath);
  const sharedForRead = readSharedConfig(local.hubClonePath);
  const duplicateCandidates = findDuplicateCandidates(corpus);
  const citedCodeDriftFindings = await checkCitedCodeDrift(corpus, createGitLastCommitDateResolver(local.knownProjectRoots ?? {}));
  const dependencyFindings = await collectDependencyFindings(pluginRoot);

  const findings = [
    ...lintCorpus(corpus),
    ...checkWipLimit(corpus, new Date(), sharedForRead.wipLimit),
    ...checkSupersessionReferences(corpus),
    ...citedCodeDriftFindings,
    ...dependencyFindings,
  ];

  // Problème 6 follow-up: re-scan every root /synapse-refresh-projects has
  // ever been given, so a project discovered manually once stays covered
  // by every later periodic audit without the root being retyped.
  const projectsRelinked = sharedForRead.refreshProjectsRoots.flatMap((rootDir) =>
    refreshProjects(rootDir, local.hubClonePath, sharedForRead.refreshProjectsExclusions),
  );

  // Problème 5: this run IS the audit — record it, locked like any other
  // shared-config write.
  const lockResult = acquireLock(local.hubClonePath, local.machineId, DEFAULT_SHARED_CONFIG.lockTimeoutMinutes);
  if (lockResult.acquired) {
    try {
      const shared = readSharedConfig(local.hubClonePath);
      writeSharedConfig(local.hubClonePath, { ...shared, lastAuditAt: new Date().toISOString() });
    } finally {
      releaseLock(local.hubClonePath, local.machineId);
    }
  }
  // Lock not acquired: another machine is mid-write. Not fatal for a
  // report-only command — the audit itself still ran and is worth
  // reporting; only the timestamp update is skipped this time.

  return {
    hubClonePath: local.hubClonePath,
    linkState,
    linkAutoFixed,
    fileCount: corpus.length,
    findings,
    duplicateCandidates,
    projectsRelinked,
    knownMachines: sharedForRead.knownMachines,
  };
}
