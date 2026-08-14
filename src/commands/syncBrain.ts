/**
 * sync-brain (périmètre IN) — auto-commit/push at SessionEnd, gated by a
 * secret scan, with a per-machine journal, never auto-merging on conflict.
 *
 * Order matters: scan BEFORE anything is staged (a secret sitting on disk
 * but never committed is still recoverable — one already committed isn't,
 * git history keeps it). Lock acquired only after the scan passes, around
 * commit — matches how bootstrap.ts locks the shared-config write, same
 * reasoning (protects a write to hub-shared state from a concurrent
 * machine). Pull --ff-only happens AFTER the local commit, not before: the
 * working tree must be clean for a pull to be safe, and it only becomes
 * clean once the local changes are committed.
 */

import { existsSync, statSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runGit } from "../config/git.js";
import { acquireLock, releaseLock } from "../lock/lock.js";
import { DEFAULT_SHARED_CONFIG } from "../config/config.js";
import { scanFilesForSecrets, type SecretMatch } from "../security/secretScan.js";

export type SyncBrainStatus =
  | "nothing-to-sync"
  | "synced"
  | "aborted-secrets-found"
  | "aborted-lock-held"
  | "aborted-push-conflict";

export interface SyncBrainResult {
  status: SyncBrainStatus;
  filesChanged?: number;
  secretsFound?: Record<string, SecretMatch[]>;
  commitHash?: string;
}

function journalPath(hubDir: string): string {
  return join(hubDir, ".synapse", "sync-journal.jsonl");
}

function appendJournalEntry(hubDir: string, entry: { machineId: string; timestamp: string; filesChanged: number }): void {
  mkdirSync(join(hubDir, ".synapse"), { recursive: true });
  appendFileSync(journalPath(hubDir), JSON.stringify(entry) + "\n", "utf8");
}

/** Parses `git status --porcelain` output into changed file paths — handles
 *  the rename format ("R  old -> new") by keeping only the new path. */
function parseChangedPaths(porcelainOutput: string): string[] {
  return porcelainOutput
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const path = line.slice(3);
      const arrowIdx = path.indexOf(" -> ");
      return arrowIdx === -1 ? path : path.slice(arrowIdx + 4);
    });
}

export async function syncBrain(hubClonePath: string, machineId: string): Promise<SyncBrainResult> {
  const statusOutput = await runGit(["status", "--porcelain"], hubClonePath);
  const changedPaths = parseChangedPaths(statusOutput);

  if (changedPaths.length === 0) {
    return { status: "nothing-to-sync" };
  }

  // git shows an untracked directory as a single "dirname/" entry rather
  // than listing every file inside it (e.g. a hub with no .gitignore yet
  // seeing .synapse/ for the first time) — filter to real files only, a
  // directory path handed to readFileSync throws EISDIR.
  const filesToScan = changedPaths
    .filter((p) => existsSync(join(hubClonePath, p)) && statSync(join(hubClonePath, p)).isFile())
    .map((p) => ({ path: p, content: readFileSync(join(hubClonePath, p), "utf8") }));
  const secretsFound = scanFilesForSecrets(filesToScan);
  if (Object.keys(secretsFound).length > 0) {
    return { status: "aborted-secrets-found", secretsFound };
  }

  const lockResult = acquireLock(hubClonePath, machineId, DEFAULT_SHARED_CONFIG.lockTimeoutMinutes);
  if (!lockResult.acquired) {
    return { status: "aborted-lock-held" };
  }

  try {
    const timestamp = new Date().toISOString();
    appendJournalEntry(hubClonePath, { machineId, timestamp, filesChanged: changedPaths.length });

    await runGit(["add", "-A"], hubClonePath);
    await runGit(["commit", "-m", `sync-brain: ${changedPaths.length} fichier(s) — ${machineId} — ${timestamp}`], hubClonePath);
    const commitHash = (await runGit(["rev-parse", "HEAD"], hubClonePath)).trim();

    try {
      await runGit(["pull", "--ff-only"], hubClonePath);
      await runGit(["push"], hubClonePath);
    } catch {
      // The commit stands locally either way — nothing lost, just not
      // pushed yet. Never force/merge; the next sync (or the user) retries.
      return { status: "aborted-push-conflict", filesChanged: changedPaths.length, commitHash };
    }

    return { status: "synced", filesChanged: changedPaths.length, commitHash };
  } finally {
    releaseLock(hubClonePath, machineId);
  }
}
