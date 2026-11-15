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
import { existsSync, realpathSync, statSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { runGit } from "../config/git.js";
import { acquireLockWithRetry, releaseLock } from "../lock/lock.js";
import { DEFAULT_SHARED_CONFIG } from "../config/config.js";
import { scanFilesForSecrets } from "../security/secretScan.js";
const DEFAULT_LOCK_WAIT_MS = 30_000;
/** Resolves symlinks/junctions too: a session may name a memory file
 *  through its project's `.claude/memory` junction rather than the hub. */
function realPathOf(path) {
    if (existsSync(path))
        return realpathSync.native(path);
    const parent = dirname(path);
    return existsSync(parent) ? join(realpathSync.native(parent), basename(path)) : path;
}
export function toHubRelative(hubClonePath, path) {
    const hubReal = realPathOf(resolve(hubClonePath));
    const target = realPathOf(resolve(hubClonePath, path));
    const rel = relative(hubReal, target);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error(`synapse: "${path}" est hors du hub (${hubClonePath}), refus de le commiter.`);
    }
    return rel.split("\\").join("/");
}
function literal(path) {
    return `:(literal)${path}`;
}
function covers(requested, staged) {
    return staged === requested || staged.startsWith(`${requested.replace(/\/+$/, "")}/`);
}
async function lastCommitTouching(hub, path) {
    const out = (await runGit(["log", "-1", "--format=%h %s", "--", literal(path)], hub)).trim();
    return out === "" ? null : out;
}
export async function commitPaths(hubClonePath, machineId, message, paths, { lockWaitMs = DEFAULT_LOCK_WAIT_MS } = {}) {
    if (message.trim() === "")
        throw new Error("synapse: message de commit vide.");
    if (paths.length === 0)
        throw new Error("synapse: aucun chemin à commiter.");
    const requested = [...new Set(paths.map((p) => toHubRelative(hubClonePath, p)))];
    // Scan BEFORE staging, same order as syncBrain: a secret on disk is
    // recoverable, a committed one is in history forever.
    const filesToScan = requested
        .map((p) => join(hubClonePath, p))
        .filter((abs) => existsSync(abs) && statSync(abs).isFile())
        .map((abs) => ({ path: toHubRelative(hubClonePath, abs), content: readFileSync(abs, "utf8") }));
    const secretsFound = scanFilesForSecrets(filesToScan);
    if (Object.keys(secretsFound).length > 0)
        return { status: "aborted-secrets-found", secretsFound };
    const lock = await acquireLockWithRetry(hubClonePath, machineId, DEFAULT_SHARED_CONFIG.lockTimeoutMinutes, {
        waitMs: lockWaitMs,
    });
    if (!lock.acquired)
        return { status: "aborted-lock-held", heldBy: lock.heldBy };
    try {
        for (const p of requested) {
            try {
                await runGit(["add", "-A", "--", literal(p)], hubClonePath);
            }
            catch {
                // Neither on disk nor tracked: nothing to stage, reported below.
            }
        }
        const stagedOut = await runGit(["diff", "--cached", "--name-only", "--no-renames", "-z", "--", ...requested.map(literal)], hubClonePath);
        const staged = stagedOut.split("\0").filter(Boolean);
        const elsewhere = [];
        for (const p of requested) {
            if (!staged.some((s) => covers(p, s))) {
                elsewhere.push({ path: p, commit: await lastCommitTouching(hubClonePath, p) });
            }
        }
        if (staged.length === 0)
            return { status: "nothing-to-commit", committed: [], elsewhere };
        await runGit(["commit", "-m", message, "--only", "--", ...staged.map(literal)], hubClonePath);
        const commitHash = (await runGit(["rev-parse", "HEAD"], hubClonePath)).trim();
        try {
            await runGit(["pull", "--ff-only"], hubClonePath);
            await runGit(["push"], hubClonePath);
        }
        catch {
            // Never force/merge: the commit stands locally, the next sync retries.
            return { status: "committed-not-pushed", commitHash, committed: staged, elsewhere };
        }
        return { status: "committed", commitHash, committed: staged, elsewhere };
    }
    finally {
        releaseLock(hubClonePath, machineId);
    }
}
//# sourceMappingURL=commitPaths.js.map