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

interface PersonalDataPattern {
  name: string;
  regex: RegExp;
}

const PATTERNS: PersonalDataPattern[] = [
  // Any hardcoded Windows absolute path under Users — \w+ covers any username
  // so this catches any maintainer's machine-specific path generically. The
  // separator uses [/\\]+ because real Windows source writes escaped double
  // backslash ("C:\\Users\\...") — a single-char class would miss that.
  { name: "hardcoded Windows path", regex: /C:[/\\]+Users[/\\]+(\w+)[/\\]+/i },
  // Same for POSIX-style absolute home paths (/home/<user>/ or /Users/<user>/).
  { name: "hardcoded POSIX path", regex: /\/(?:home|Users)\/(\w+)\//i },
  // Maintainer-specific patterns (employer email domain, first name, machine
  // usernames, etc.) are intentionally absent here — they belong in a local
  // config or CI secret, never committed to the public repo. Add them in your
  // own fork's local-config.json or as a separate gitignored deny-list.
];

/**
 * Noms d'utilisateur qui sont des PLACEHOLDERS de documentation, pas des
 * identités réelles — ajouté 01/10/2026.
 *
 * Les motifs ci-dessus visent, selon leur propre commentaire, les chemins
 * « machine-specific » du mainteneur. Un fichier qui DOCUMENTE un chemin
 * Windows (skills/synapse-sync-status/SKILL.md) ou un test qui en fabrique
 * un n'a pas d'autre choix que d'écrire un exemple : sans cette liste, le
 * scan rendait impossible de documenter la chose même que le projet
 * manipule, et produisait 10 faux positifs sur 11 détections (mesuré le
 * 01/10 — la 11e était une vraie fuite, le nom d'utilisateur réel du
 * mainteneur dans SKILL.md).
 *
 * Volontairement une liste COURTE et explicite, pas une heuristique : un
 * nom qui n'y figure pas est traité comme une identité réelle. Le défaut
 * reste donc la détection, l'exemption est l'exception nommée.
 */
const PLACEHOLDER_USERS = new Set(["exemple", "example", "utilisateur", "user", "username", "monuser", "youruser"]);

function isPlaceholderUser(captured: string | undefined): boolean {
  return captured !== undefined && PLACEHOLDER_USERS.has(captured.toLowerCase());
}

export interface PersonalDataMatch {
  pattern: string;
  line: number;
  excerpt: string;
}

export function scanContentForPersonalData(content: string): PersonalDataMatch[] {
  const matches: PersonalDataMatch[] = [];
  content.split("\n").forEach((line, idx) => {
    for (const pattern of PATTERNS) {
      const match = line.match(pattern.regex);
      if (match && !isPlaceholderUser(match[1])) {
        matches.push({ pattern: pattern.name, line: idx + 1, excerpt: match[0] });
      }
    }
  });
  return matches;
}

export interface ScannedFile {
  path: string;
  content: string;
}

/** Only files with at least one match appear in the result — an empty
 *  object means the scan is clean, not "nothing was scanned". */
export function scanFilesForPersonalData(files: ScannedFile[]): Record<string, PersonalDataMatch[]> {
  const result: Record<string, PersonalDataMatch[]> = {};
  for (const file of files) {
    const matches = scanContentForPersonalData(file.content);
    if (matches.length > 0) result[file.path] = matches;
  }
  return result;
}
