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
export interface SecretMatch {
    pattern: string;
    line: number;
    excerpt: string;
}
export declare function scanContentForSecrets(content: string): SecretMatch[];
export interface ScannedFile {
    path: string;
    content: string;
}
/** Only files with at least one match appear in the result — an empty
 *  object means the scan is clean, not "nothing was scanned". */
export declare function scanFilesForSecrets(files: ScannedFile[]): Record<string, SecretMatch[]>;
