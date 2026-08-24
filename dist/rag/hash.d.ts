/**
 * Corpus fingerprinting — drives the "rebuild only if something changed"
 * rule (problème 4/5, 13/08): the RAG index refreshes at SessionStart only
 * when this fingerprint differs from the one stored alongside the vectors.
 */
export interface CorpusFile {
    path: string;
    content: string;
}
/** Order-independent so a directory listing returned in a different order
 *  doesn't look like a change. */
export declare function computeCorpusFingerprint(files: CorpusFile[]): string;
/** Per-file content hash — what the incremental rebuild (search.ts) diffs
 *  against to decide which files actually need re-chunking/re-embedding,
 *  instead of the whole-corpus fingerprint invalidating everything on any
 *  single change. Added 14/08 after the real-hub test: a 121-file corpus
 *  full-rebuilding on every edit was measurably slow ("le temps a été très
 *  long") — most of those files hadn't changed at all. */
export declare function hashFileContent(content: string): string;
