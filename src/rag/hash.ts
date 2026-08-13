/**
 * Corpus fingerprinting — drives the "rebuild only if something changed"
 * rule (problème 4/5, 13/08): the RAG index refreshes at SessionStart only
 * when this fingerprint differs from the one stored alongside the vectors.
 */

import { createHash } from "node:crypto";

export interface CorpusFile {
  path: string;
  content: string;
}

/** Order-independent so a directory listing returned in a different order
 *  doesn't look like a change. */
export function computeCorpusFingerprint(files: CorpusFile[]): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const hash = createHash("sha256");
  for (const f of sorted) {
    hash.update(f.path);
    hash.update("\0");
    hash.update(f.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}
