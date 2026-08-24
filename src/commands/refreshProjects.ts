/**
 * refresh-projects (périmètre IN, problème 6) — scans a root directory for
 * Claude Code projects and ensures each has its memory linked to the hub.
 *
 * "Claude Code project" is detected by the presence of a .claude/
 * subdirectory — a well-known, visible convention, not invented for this.
 * Memory convention chosen here: <project>/.claude/memory, linked via
 * ensureHubLink() (already idempotent, already tested — reused, not
 * reimplemented). This is a real assumption, not verified against Claude
 * Code internals beyond the .claude/ marker itself — flagged as such
 * rather than presented as certain.
 *
 * Slugs abandoned (a project directory removed after being linked): the
 * orphaned link is left alone, per design ("v1 ne nettoie pas") — this
 * function only ever adds links, never removes.
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { ensureHubLink, ensureDirectory, type EnsureLinkResult } from "../jonction/jonction.js";

export interface RefreshProjectsResult {
  projectDir: string;
  link: EnsureLinkResult;
}

/** The one place that knows the per-project memory link convention
 *  (<project>/.claude/memory) — was duplicated 3x across this file and
 *  refreshIndex.ts (found 14/08, code review) before being extracted here. */
export function projectMemoryLinkPath(projectDir: string): string {
  return join(projectDir, ".claude", "memory");
}

export function refreshProjects(rootDir: string, hubClonePath: string, exclusions: string[] = []): RefreshProjectsResult[] {
  const excluded = new Set(exclusions);
  const results: RefreshProjectsResult[] = [];

  for (const entry of readdirSync(rootDir)) {
    if (excluded.has(entry)) continue;
    const projectDir = join(rootDir, entry);
    if (!statSync(projectDir).isDirectory()) continue;
    if (!existsSync(join(projectDir, ".claude"))) continue; // not a Claude Code project

    results.push({ projectDir, link: ensureHubLink(hubClonePath, projectMemoryLinkPath(projectDir)) });
  }

  return results;
}

/** The SessionStart-time counterpart: ensures ONE specific project (the
 *  current one, from ${CLAUDE_PROJECT_DIR}) is linked, without scanning a
 *  whole root — "zero action utilisateur" per the design, cheap enough to
 *  run every session start.
 *
 *  Unlike refreshProjects() above, this is meant to run on a project Claude
 *  Code has NEVER seen before — the ".claude/ marker already exists" guard
 *  that keeps refreshProjects() safe doesn't apply here by design. Found
 *  24/08 (real end-to-end run, not caught by any existing unit test):
 *  createLink() never creates linkPath's own parent directory, so linking
 *  ".claude/memory" under a project whose ".claude/" doesn't exist yet
 *  crashed on exactly the "brand-new project" case this function exists
 *  for. ensureDirectory() is idempotent (mkdirSync recursive) — safe to
 *  call unconditionally, including when .claude/ already exists. */
export function ensureCurrentProjectLinked(projectDir: string, hubClonePath: string): EnsureLinkResult {
  const linkPath = projectMemoryLinkPath(projectDir);
  ensureDirectory(dirname(linkPath));
  return ensureHubLink(hubClonePath, linkPath);
}
