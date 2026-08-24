/**
 * --dry-run support (problème 3, 13/08): manual-only, never wired into an
 * automatic hook (SessionStart/SessionEnd must stay non-interactive — there
 * is nobody to read a preview during a hook). This module only parses
 * `git status --porcelain` output into something a manual command can
 * display; it never executes anything.
 */
const STATUS_MAP = {
    A: "added",
    M: "modified",
    D: "deleted",
    "??": "untracked",
};
export function parseGitStatusPorcelain(porcelain) {
    if (porcelain.trim() === "")
        return [];
    return porcelain
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => {
        const code = line.slice(0, 2).trim();
        const path = line.slice(3).trim();
        const status = STATUS_MAP[code] ?? "unknown";
        return { status, path };
    });
}
//# sourceMappingURL=dryrun.js.map