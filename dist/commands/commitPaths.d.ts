/**
 * commit-paths (15/11/2026): the way a SESSION commits into the hub.
 *
 * Several Claude sessions share one hub working tree and one index. A
 * session doing `git add -A` swept another session's edit into its own
 * commit; the second session's `git commit` then found nothing, and
 * `git log -1` showed someone else's commit. Here:
 * - only the named paths are committed (`commit --only`), whatever else
 *   other sessions modified or staged;
 * - under the hub lock, held per process, so commits and SessionEnd syncs queue;
 * - a path another session already committed is reported with THAT commit,
 *   instead of a silent "nothing to commit".
 */
import { type SecretMatch } from "../security/secretScan.js";
export type CommitPathsStatus = "committed" | "committed-not-pushed" | "nothing-to-commit" | "aborted-secrets-found" | "aborted-lock-held";
export interface ElsewherePath {
    path: string;
    /** "<short hash> <subject>" of the last commit touching it, null if none. */
    commit: string | null;
}
export interface CommitPathsResult {
    status: CommitPathsStatus;
    commitHash?: string;
    committed?: string[];
    elsewhere?: ElsewherePath[];
    secretsFound?: Record<string, SecretMatch[]>;
    heldBy?: string;
}
export interface CommitPathsOptions {
    /** How long to wait for another process holding the lock. */
    lockWaitMs?: number;
}
export declare function toHubRelative(hubClonePath: string, path: string): string;
export declare function commitPaths(hubClonePath: string, machineId: string, message: string, paths: string[], { lockWaitMs }?: CommitPathsOptions): Promise<CommitPathsResult>;
