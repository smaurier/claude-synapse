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
export interface PersonalDataMatch {
    pattern: string;
    line: number;
    excerpt: string;
}
export declare function scanContentForPersonalData(content: string): PersonalDataMatch[];
export interface ScannedFile {
    path: string;
    content: string;
}
/** Only files with at least one match appear in the result — an empty
 *  object means the scan is clean, not "nothing was scanned". */
export declare function scanFilesForPersonalData(files: ScannedFile[]): Record<string, PersonalDataMatch[]>;
