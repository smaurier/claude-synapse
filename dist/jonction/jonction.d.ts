/**
 * Cross-platform directory linking: NTFS junction on Windows, symlink elsewhere.
 *
 * This module is the load-bearing piece of Synapse's whole thesis: there is
 * exactly one physical copy of the memory (the hub); every other location is
 * a link to it, never a copy. Every function here is written defensively
 * around two failure modes that would silently break that guarantee:
 *
 *   1. A regular Windows symlink requires admin rights / developer mode.
 *      We always request a 'junction' on win32 — junctions need neither.
 *   2. Removing a link by walking its target (a recursive rm that follows
 *      the link instead of deleting the link itself) would destroy the
 *      real hub content through the link. Every removal path here checks
 *      `isSymbolicLink()` first and uses `unlinkSync`, never `rmSync`.
 */
export type LinkState = "ok" | "wrong-target" | "broken" | "missing";
/** 'junction' on Windows (no admin/dev-mode needed), undefined elsewhere (ignored by fs.symlink on POSIX). */
export declare function platformLinkType(): "junction" | undefined;
/**
 * Inspects what currently lives at linkPath relative to the expected hub target.
 * Never throws for a normal filesystem state — that's the whole point of a
 * pre-flight check callers can branch on instead of catching exceptions.
 */
export declare function inspectLink(linkPath: string, expectedTarget: string): LinkState;
/**
 * Creates a link at linkPath pointing at target. Hard-stops with a
 * diagnostic-oriented error on failure — NEVER falls back to copying files,
 * because a silent copy would quietly break the "zero copy" guarantee the
 * whole plugin exists to provide.
 */
export declare function createLink(target: string, linkPath: string): void;
/**
 * Removes ONLY a symlink/junction. Refuses (throws, touches nothing) if the
 * path is not actually a link — this is the single most safety-critical
 * function in the module: a recursive directory removal that followed a
 * junction instead of deleting the junction itself would wipe the real hub
 * content on the other end of the link.
 */
export declare function removeLink(linkPath: string): void;
/**
 * Renames a pre-existing real directory out of the way with a visible,
 * timestamped backup name — never deletes, never asks (there is nothing to
 * lose: it's a rename). Meant to run BEFORE createLink() when inspectLink()
 * returned "missing" but something real already occupies linkPath.
 */
export declare function backupExisting(path: string): string;
/**
 * Post-install sanity check: writes a uniquely-named marker file through the
 * link and confirms it is visible at the real hub path — proof the link
 * functions in practice, not just that its creation call didn't error.
 * Cleans up after itself either way.
 */
export declare function verifyWriteThrough(linkPath: string, hubPath: string): boolean;
export type EnsureLinkAction = "already-ok" | "created" | "recreated" | "recreated-after-backup";
export interface EnsureLinkResult {
    action: EnsureLinkAction;
    backupPath?: string;
}
/**
 * Idempotent, interactive-mode link reconciliation (problème 1, design
 * decided 13/08, implemented 14/08 while wiring /synapse-init — the
 * orchestration of inspectLink/createLink/removeLink/backupExisting into
 * "make it correct" existed only as individual primitives until now).
 * Safe to call every time /synapse-init runs, not just the first: already
 * correct -> no-op. Auto-fixes wrong-target/broken links and backs up real
 * pre-existing content automatically, visibly (per design: "renommage
 * horodaté automatique, visible" — no prompt, since nothing is lost).
 *
 * This is the INTERACTIVE-mode behavior specifically. The hook/automatic-
 * mode counterpart is deliberately different (silent-if-ok, abort + alert
 * on any problem, never auto-fixes) and is a separate, not-yet-built piece
 * — conflating the two here would blur a distinction the design draws on
 * purpose.
 */
export declare function ensureHubLink(hubClonePath: string, linkPath: string): EnsureLinkResult;
export declare function ensureDirectory(path: string): void;
export declare function listDirectory(path: string): string[];
