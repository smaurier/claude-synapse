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
export declare const DEFAULT_MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
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
/**
 * Resolves and pins SharedConfig.ragEmbeddingModelVersion — the field
 * existed in the design since problème 4 (13/08) as the mechanism meant to
 * settle RAG divergence by construction, but nothing ever actually read or
 * wrote it (found 16/08, code review of the design backlog). "unset" (first
 * real use on this hub) pins DEFAULT_MODEL_ID and persists it, so every
 * other machine that later reads this hub sees the same value and never
 * silently drifts onto a different model — mixing embedding spaces in one
 * index is meaningless (see cosineSimilarity's own reasoning). Anything
 * already pinned to something OTHER than DEFAULT_MODEL_ID is refused:
 * swapping models needs a full corpus re-embed at the new model's own
 * chunking budget (max_seq_length, special-token reserve — both measured
 * empirically per model, see chunkFileForEmbedding above), not built yet.
 * Surfacing the mismatch beats silently embedding at the wrong budget for
 * whatever model is actually configured.
 *
 * No lock, unlike every other shared-config write: this one only ever
 * converges on the same value regardless of which machine gets there first
 * (there's exactly one real supported model right now), so a race between
 * two machines pinning at once is harmless.
 */
export declare function ensurePinnedEmbeddingModel(hubClonePath: string): string;
