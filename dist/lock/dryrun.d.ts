/**
 * --dry-run support (problème 3, 13/08): manual-only, never wired into an
 * automatic hook (SessionStart/SessionEnd must stay non-interactive — there
 * is nobody to read a preview during a hook). This module only parses
 * `git status --porcelain` output into something a manual command can
 * display; it never executes anything.
 */
export interface FileChange {
    status: "added" | "modified" | "deleted" | "untracked" | "unknown";
    path: string;
}
export declare function parseGitStatusPorcelain(porcelain: string): FileChange[];
