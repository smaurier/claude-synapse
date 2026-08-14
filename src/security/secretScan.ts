/**
 * Secret scan before push (périmètre IN) — pattern-based against known
 * secret formats, NOT entropy analysis. Deliberately scoped: catching
 * well-known token/key shapes (AWS, GitHub, Slack, PEM private keys,
 * generic api_key/secret/token/password assignments) covers the common,
 * costly mistakes without the false-positive cost and complexity of a full
 * entropy-based detector — a documented trade-off, not an oversight.
 *
 * Matches are redacted before being surfaced anywhere (first/last 4 chars
 * only) — a scanner that leaks the very secret it found defeats its point.
 */

interface SecretPattern {
  name: string;
  regex: RegExp;
}

const PATTERNS: SecretPattern[] = [
  { name: "clé privée PEM", regex: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: "token GitHub", regex: /\bgh[opsu]_[A-Za-z0-9]{36,}\b/ },
  { name: "clé d'accès AWS", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "token Slack", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    name: "clé/secret assigné en dur",
    regex: /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-/+]{16,}['"]/i,
  },
];

export interface SecretMatch {
  pattern: string;
  line: number;
  excerpt: string;
}

function redact(secret: string): string {
  const trimmed = secret.trim();
  return trimmed.length <= 8 ? "****" : `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export function scanContentForSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  content.split("\n").forEach((line, idx) => {
    for (const pattern of PATTERNS) {
      const match = line.match(pattern.regex);
      if (match) {
        matches.push({ pattern: pattern.name, line: idx + 1, excerpt: redact(match[0]) });
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
export function scanFilesForSecrets(files: ScannedFile[]): Record<string, SecretMatch[]> {
  const result: Record<string, SecretMatch[]> = {};
  for (const file of files) {
    const matches = scanContentForSecrets(file.content);
    if (matches.length > 0) result[file.path] = matches;
  }
  return result;
}
