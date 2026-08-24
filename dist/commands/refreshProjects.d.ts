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
import { type EnsureLinkResult } from "../jonction/jonction.js";
export interface RefreshProjectsResult {
    projectDir: string;
    link: EnsureLinkResult;
}
/** The one place that knows the per-project memory link convention
 *  (<project>/.claude/memory) — was duplicated 3x across this file and
 *  refreshIndex.ts (found 14/08, code review) before being extracted here. */
export declare function projectMemoryLinkPath(projectDir: string): string;
export declare function refreshProjects(rootDir: string, hubClonePath: string, exclusions?: string[]): RefreshProjectsResult[];
/** The SessionStart-time counterpart: ensures ONE specific project (the
 *  current one, from ${CLAUDE_PROJECT_DIR}) is linked, without scanning a
 *  whole root — "zero action utilisateur" per the design, cheap enough to
 *  run every session start. */
export declare function ensureCurrentProjectLinked(projectDir: string, hubClonePath: string): EnsureLinkResult;
