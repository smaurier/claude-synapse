/**
 * Real local embedding, wired 13/08 after the design decision (problème 4)
 * and the user's push-back on trusting a character-count estimate ("il
 * faudrait avoir une méthode sûre"). Uses transformers.js (WASM, no native
 * binary per OS/arch — same reasoning that led to node:sqlite over
 * sqlite-vec).
 *
 * Model swapped 14/08 from all-MiniLM-L6-v2 to paraphrase-multilingual-
 * MiniLM-L12-v2: the original choice is English-only by training data
 * (verified against its model card — no French, no multilingual claim
 * anywhere in it), while the user's real corpus is 100% French. Same 384-dim
 * output (no downstream schema change), but a real trade-off: max sequence
 * length drops from 256 to 128, so the chunking budget below is smaller and
 * was re-validated from scratch, not just halved by assumption.
 *
 * Chunking here is ALWAYS token-aware (tokenChunk.ts), never the character
 * heuristic in chunk.ts — this is the one place with a real tokenizer
 * available, so there is no reason to estimate.
 */
import type { Chunk } from "./chunk.js";
export { DEFAULT_MODEL_ID, defaultModelCacheDir, ensurePinnedEmbeddingModel, getEmbedderIdentity } from "./embedderIdentity.js";
/** À appeler AVANT le premier chargement du modèle (les promesses ci-dessous
 *  sont paresseuses, donc avant le premier embedLocal/chunkFileForEmbedding).
 *  Un test de contrat (tests/modelCache.test.ts) vérifie que chaque module de
 *  src/commands qui atteint l'embedding fait cet appel. */
export declare function useModelCacheDir(dir: string): void;
/** Token-aware chunking backed by the real model's tokenizer — chunk
 *  boundaries are exact, not estimated from a chars-per-token ratio. */
export declare function chunkFileForEmbedding(path: string, content: string): Promise<Chunk[]>;
/**
 * Embeds one chunk of text. Includes a defensive check even though
 * chunkFileForEmbedding() should make it unreachable: if a chunk somehow
 * still exceeds the model's window (e.g. called directly with unchunked
 * text), warn loudly instead of letting the model truncate in silence.
 */
export declare function embedLocal(text: string): Promise<number[]>;
