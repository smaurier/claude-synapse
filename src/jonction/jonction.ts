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

import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type LinkState = "ok" | "wrong-target" | "broken" | "missing";

/** 'junction' on Windows (no admin/dev-mode needed), undefined elsewhere (ignored by fs.symlink on POSIX). */
export function platformLinkType(): "junction" | undefined {
  return process.platform === "win32" ? "junction" : undefined;
}

function normalizeForComparison(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Inspects what currently lives at linkPath relative to the expected hub target.
 * Never throws for a normal filesystem state — that's the whole point of a
 * pre-flight check callers can branch on instead of catching exceptions.
 */
export function inspectLink(linkPath: string, expectedTarget: string): LinkState {
  let stat;
  try {
    stat = lstatSync(linkPath);
  } catch {
    return "missing";
  }

  if (!stat.isSymbolicLink()) {
    // A real file or directory sits there — not our concern here, that's
    // exactly the case backupExisting()/createLink() are meant to handle.
    return "missing";
  }

  if (!existsSync(linkPath)) {
    // lstat succeeded (the link itself exists) but the resolved path doesn't
    // — a dangling link.
    return "broken";
  }

  let actualTarget: string;
  try {
    actualTarget = readlinkSync(linkPath);
  } catch {
    return "broken";
  }

  return normalizeForComparison(actualTarget) === normalizeForComparison(expectedTarget)
    ? "ok"
    : "wrong-target";
}

/**
 * Creates a link at linkPath pointing at target. Hard-stops with a
 * diagnostic-oriented error on failure — NEVER falls back to copying files,
 * because a silent copy would quietly break the "zero copy" guarantee the
 * whole plugin exists to provide.
 */
export function createLink(target: string, linkPath: string): void {
  if (!isAbsolute(target)) {
    throw new Error(
      `synapse: le chemin cible doit être absolu, reçu "${target}". ` +
        `Une jonction Windows exige un chemin absolu ; l'exiger partout évite un bug qui ne se voit qu'un OS sur deux.`,
    );
  }

  try {
    symlinkSync(target, linkPath, platformLinkType());
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `synapse: échec de création du lien "${linkPath}" -> "${target}".\n` +
        `Diagnostic : ${cause}\n` +
        `Causes probables : le système de fichiers cible n'est pas NTFS (clé USB FAT32, lecteur réseau), ` +
        `un antivirus bloque la création, ou le dossier parent de "${linkPath}" n'existe pas encore. ` +
        `Aucun repli en copie de fichiers n'est tenté : la garantie "zéro copie" ne doit jamais être rompue en silence.`,
    );
  }
}

/**
 * Removes ONLY a symlink/junction. Refuses (throws, touches nothing) if the
 * path is not actually a link — this is the single most safety-critical
 * function in the module: a recursive directory removal that followed a
 * junction instead of deleting the junction itself would wipe the real hub
 * content on the other end of the link.
 */
export function removeLink(linkPath: string): void {
  let stat;
  try {
    stat = lstatSync(linkPath);
  } catch {
    throw new Error(`synapse: rien à supprimer à "${linkPath}".`);
  }

  if (!stat.isSymbolicLink()) {
    throw new Error(
      `synapse: refus de supprimer "${linkPath}" — ce n'est pas un lien (jonction/symlink), ` +
        `c'est un dossier ou fichier réel. Une suppression récursive ici effacerait du contenu réel, ` +
        `pas juste un lien. Utiliser un outil de suppression de fichiers normal si c'est bien l'intention.`,
    );
  }

  // unlinkSync removes the link itself; it never follows it. This is the
  // one line in the whole codebase that must never become fs.rmSync(..., { recursive: true }).
  unlinkSync(linkPath);
}

/**
 * Renames a pre-existing real directory out of the way with a visible,
 * timestamped backup name — never deletes, never asks (there is nothing to
 * lose: it's a rename). Meant to run BEFORE createLink() when inspectLink()
 * returned "missing" but something real already occupies linkPath.
 */
export function backupExisting(path: string): string {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new Error(
      `synapse: "${path}" est déjà un lien — backupExisting() est pour du contenu réel préexistant, ` +
        `pas pour déplacer un lien (utiliser removeLink() dans ce cas).`,
    );
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const backupPath = `${path}.bak-${stamp}`;
  renameSync(path, backupPath);
  return backupPath;
}

/**
 * Post-install sanity check: writes a uniquely-named marker file through the
 * link and confirms it is visible at the real hub path — proof the link
 * functions in practice, not just that its creation call didn't error.
 * Cleans up after itself either way.
 */
export function verifyWriteThrough(linkPath: string, hubPath: string): boolean {
  const marker = `.synapse-write-test-${process.pid}-${Date.now()}`;
  const throughLink = `${linkPath}/${marker}`;
  const atHub = `${hubPath}/${marker}`;

  writeFileSync(throughLink, `synapse write-through check ${new Date().toISOString()}`);
  try {
    return existsSync(atHub);
  } finally {
    if (existsSync(atHub)) rmSync(atHub, { force: true });
    else if (existsSync(throughLink)) rmSync(throughLink, { force: true });
  }
}

// Re-exported for callers that need to prepare a target directory (e.g. the hub)
// before the first link is ever created — not part of the link-safety-critical path.
export function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function listDirectory(path: string): string[] {
  return readdirSync(path);
}
