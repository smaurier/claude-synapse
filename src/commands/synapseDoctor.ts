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

import { readLocalConfig, defaultLocalConfigPath, readSharedConfig, writeSharedConfig, recordMachineSeen, DEFAULT_SHARED_CONFIG } from "../config/config.js";
import { acquireLock, releaseLock } from "../lock/lock.js";
import { loadCorpus } from "../rag/corpus.js";
import { embedLocal, chunkFileForEmbedding, ensurePinnedEmbeddingModel } from "../rag/embeddingProvider.js";
import { inspectLink, createLink, removeLink, type LinkState } from "../jonction/jonction.js";
import { lintCorpus, findMergeCandidatesGuarded, checkWipLimit, type LintFinding, type MergeCandidate } from "./brainLint.js";
import { refreshProjects, type RefreshProjectsResult } from "./refreshProjects.js";

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

export async function runSynapseDoctor(pluginDataDir: string, linkPath: string): Promise<SynapseDoctorReport> {
  const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
  ensurePinnedEmbeddingModel(local.hubClonePath);
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
  const corpus = loadCorpus(local.hubClonePath);
  const sharedForRead = readSharedConfig(local.hubClonePath);
  const merge = await findMergeCandidatesGuarded(corpus, embedLocal, chunkFileForEmbedding, sharedForRead.mergeCandidatesMaxFiles);
  const findings = [...lintCorpus(corpus), ...checkWipLimit(corpus, new Date(), sharedForRead.wipLimit), ...merge.findings];
  const mergeCandidates = merge.mergeCandidates;

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
    mergeCandidates,
    projectsRelinked,
    knownMachines: sharedForRead.knownMachines,
  };
}
