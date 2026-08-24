/**
 * Splits long files into overlapping windows before embedding.
 *
 * Added after Claude reviewed a RAG primer the user pasted in and caught a
 * real gap: all-MiniLM-L6-v2 (the model chosen for problème 4) truncates
 * input at 256 tokens. Memory files regularly exceed that — without
 * chunking, everything past the truncation point of a long file would be
 * silently invisible to search. Short files (the common case) get a single
 * chunk whose id is just the file path, so most of the corpus pays zero
 * overhead for this.
 *
 * DEFAULT_MAX_CHARS is calibrated on measured tokenization, not a guessed
 * ratio: an initial estimate of ~4 chars/token (typical for English prose)
 * was checked against the real tokenizer on actual French markdown content
 * (accents, code spans, [[wiki-links]], Windows paths) and measured at
 * ~2.7-3 chars/token instead — at the old 800-char default, real samples
 * came out to 228-300 tokens, already past the 256 limit. 500 chars keeps
 * comfortable margin even for token-dense content (see
 * scripts/tokentest.mjs for the measurement).
 */
export interface Chunk {
    chunkId: string;
    sourcePath: string;
    text: string;
}
export declare function chunkFile(path: string, content: string, maxChars?: number, overlapChars?: number): Chunk[];
/** True if a chunkId produced by chunkFile carries a "#N" suffix. */
export declare function sourcePathFromChunkId(chunkId: string): string;
