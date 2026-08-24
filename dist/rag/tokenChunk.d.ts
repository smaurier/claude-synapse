/**
 * Token-aware chunking — the reliable replacement for the character-count
 * heuristic in chunk.ts. the user's push-back on 13/08 was right: no fixed
 * chars-per-token ratio can be trusted across languages/content mixes (we
 * measured French markdown at ~2.7-3 chars/token vs. the ~4 assumed for
 * English, which would have silently overflowed the model's 256-token
 * limit even after "fixing" the default to 500 chars). This module
 * tokenizes with the SAME tokenizer that will run at embedding time and
 * windows over actual token ids — the chunk boundaries are exact by
 * construction, not estimated.
 *
 * The tokenizer is injected (encode/decode only) so this stays testable
 * without loading a real model; embeddingProvider.ts wires it to the real
 * one.
 */
import type { Chunk } from "./chunk.js";
export interface Tokenizer {
    encode: (text: string) => number[];
    decode: (ids: number[]) => string;
}
export declare function chunkFileByTokens(path: string, content: string, tokenizer: Tokenizer, maxTokens: number, overlapTokens: number): Chunk[];
