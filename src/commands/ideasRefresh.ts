/**
 * The other half of backlog item 54's daemon-less mechanism (see refreshIndex.ts
 * for the trigger side). Once `/synapse-ideas-refresh` has actually done the real
 * work — reading `reference_toutes_les_idees.md` plus the hub's idea-bearing
 * fiches and judging what changed, which needs a model and therefore cannot
 * happen inside a SessionStart hook — the skill calls this to advance the clock.
 * Same pattern synapseDoctor.ts uses for lastAuditAt: locked, because two
 * machines could otherwise race on the same shared config write.
 */

import { readSharedConfig, writeSharedConfig, DEFAULT_SHARED_CONFIG } from "../config/config.js";
import { acquireLock, releaseLock } from "../lock/lock.js";

export interface MarkIdeasRefreshedResult {
  /** False only when another machine currently holds the lock — not an error,
   *  just means this run's timestamp update is skipped (the synthesis itself
   *  already happened and its file edits are not gated by this lock). */
  written: boolean;
}

export function markIdeasRefreshed(hubDir: string, machineId: string): MarkIdeasRefreshedResult {
  const lockResult = acquireLock(hubDir, machineId, DEFAULT_SHARED_CONFIG.lockTimeoutMinutes);
  if (!lockResult.acquired) {
    return { written: false };
  }
  try {
    const shared = readSharedConfig(hubDir);
    writeSharedConfig(hubDir, { ...shared, lastIdeasRefreshAt: new Date().toISOString() });
    return { written: true };
  } finally {
    releaseLock(hubDir, machineId);
  }
}
