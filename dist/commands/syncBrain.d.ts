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
import { type SecretMatch } from "../security/secretScan.js";
export type SyncBrainStatus = "nothing-to-sync" | "synced" | "aborted-secrets-found" | "aborted-lock-held" | "aborted-push-conflict";
export interface SyncBrainResult {
    status: SyncBrainStatus;
    filesChanged?: number;
    secretsFound?: Record<string, SecretMatch[]>;
    commitHash?: string;
}
export declare function syncBrain(hubClonePath: string, machineId: string): Promise<SyncBrainResult>;
