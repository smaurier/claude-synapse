/**
 * Personal-data scan (backlog 16/08, étude de marché Synapse) — same shape
 * as secretScan.ts on purpose, different target: secretScan.ts protects
 * the user's private hub from leaking credentials into it; this protects
 * claude-synapse's own public repo from leaking the maintainer's identity
 * into it. Different boundary (repo, not memory context), same underlying
 * discipline grandma's "sweater" test demonstrated: prove isolation with a
 * test, not a one-time manual review.
 *
 * Answers a real gap already found once (14/08): the pre-first-push
 * "revue anti-données-perso" was a targeted grep, never a full re-read —
 * this is what a full, repeatable check looks like instead of trusting
 * memory to catch it again next time.
 *
 * The denylist below is a starting point built from what has actually
 * leaked into this repo before (per project memory: employer email in git
 * config, a hardcoded personal path in a script, the maintainer's first
 * name in code comments) — not a guessed-at exhaustive list. Extend it as
 * new categories are found, the same way PATTERNS in secretScan.ts grew.
 */
const PATTERNS = [
    { name: "domaine email employeur", regex: /@lrtechnologies\.fr\b/i },
    // Windows and POSIX home paths for either of the maintainer's two
    // machines — a hardcoded absolute path is a leak regardless of which
    // poste wrote it (feedback_chemins_multipostes: every absolute path
    // belongs to a specific machine, never portable). `+` on the separator,
    // not a single char: real source writes a Windows path as an escaped
    // double backslash ("C:\\Users\\...") — a single-backslash separator
    // would miss that, the actual, realistic shape this is meant to catch.
    { name: "chemin personnel réel", regex: /[/\\]+Users[/\\]+(sylva|lrtechnologies)[/\\]+/i },
    // Word-boundary aware (Unicode-aware, same reasoning as findExactMatches
    // in hybridSearch.ts) — a plain substring match previously produced real
    // false positives there ("LEP" inside "FilePath"); same risk here
    // against words that merely contain "sylvain".
    { name: "prénom en clair", regex: /(?<![\p{L}\p{N}_])sylvain(?![\p{L}\p{N}_])/iu },
];
export function scanContentForPersonalData(content) {
    const matches = [];
    content.split("\n").forEach((line, idx) => {
        for (const pattern of PATTERNS) {
            const match = line.match(pattern.regex);
            if (match) {
                matches.push({ pattern: pattern.name, line: idx + 1, excerpt: match[0] });
            }
        }
    });
    return matches;
}
/** Only files with at least one match appear in the result — an empty
 *  object means the scan is clean, not "nothing was scanned". */
export function scanFilesForPersonalData(files) {
    const result = {};
    for (const file of files) {
        const matches = scanContentForPersonalData(file.content);
        if (matches.length > 0)
            result[file.path] = matches;
    }
    return result;
}
//# sourceMappingURL=personalDataScan.js.map