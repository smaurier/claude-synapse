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

import { AutoTokenizer, pipeline, type FeatureExtractionPipeline, type PreTrainedTokenizer } from "@huggingface/transformers";
import { chunkFileByTokens, type Tokenizer } from "./tokenChunk.js";
import type { Chunk } from "./chunk.js";

const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const MODEL_MAX_TOKENS = 128;
// This tokenizer (XLM-R sentencepiece, cased, no accent-stripping) round-
// trips much more cleanly than all-MiniLM-L6-v2's uncased WordPiece one: a
// flat reserve of 4 tokens for special tokens ([CLS]/[SEP] etc.) was enough
// — verified 14/08 with scripts/validate-chunking.mjs against the ENTIRE
// real memory corpus (104 files, 1380 chunks at this budget), zero
// violations. (The old model needed 16, not 2, for the same reason in
// reverse: its decode step lowercases/strips accents, shifting subword
// boundaries on re-encode — this model doesn't do that normalization.)
const SPECIAL_TOKEN_RESERVE = 4;
const MAX_CONTENT_TOKENS = MODEL_MAX_TOKENS - SPECIAL_TOKEN_RESERVE;
const OVERLAP_TOKENS = 16;

let tokenizerPromise: Promise<PreTrainedTokenizer> | null = null;
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

async function getTokenizer(): Promise<PreTrainedTokenizer> {
  tokenizerPromise ??= AutoTokenizer.from_pretrained(MODEL_ID);
  return tokenizerPromise;
}

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  // dtype: "q8" — measured 14/08: the default (fp32) weights are 470MB and
  // took ~5min to download; the int8-quantized variant is ~120MB and loads
  // in ~50s. A plugin meant to stay light shouldn't default to the heavy
  // variant. Same 384-dim output; not re-validated for embedding-quality
  // loss vs fp32 (quantization is a known, generally small trade-off for
  // sentence-similarity tasks, but that's an assumption, not measured here).
  extractorPromise ??= pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
  return extractorPromise;
}

function toTokenizerAdapter(tokenizer: PreTrainedTokenizer): Tokenizer {
  return {
    // add_special_tokens: false — the windowing budget (MAX_CONTENT_TOKENS)
    // is a content-only budget; the +2 [CLS]/[SEP] get added back by the
    // real embedding call later, and are already reserved for.
    encode: (text: string) => tokenizer.encode(text, { add_special_tokens: false }),
    decode: (ids: number[]) => tokenizer.decode(ids, { skip_special_tokens: true }),
  };
}

/** Token-aware chunking backed by the real model's tokenizer — chunk
 *  boundaries are exact, not estimated from a chars-per-token ratio. */
export async function chunkFileForEmbedding(path: string, content: string): Promise<Chunk[]> {
  const tokenizer = await getTokenizer();
  return chunkFileByTokens(path, content, toTokenizerAdapter(tokenizer), MAX_CONTENT_TOKENS, OVERLAP_TOKENS);
}

/**
 * Embeds one chunk of text. Includes a defensive check even though
 * chunkFileForEmbedding() should make it unreachable: if a chunk somehow
 * still exceeds the model's window (e.g. called directly with unchunked
 * text), warn loudly instead of letting the model truncate in silence.
 */
export async function embedLocal(text: string): Promise<number[]> {
  const tokenizer = await getTokenizer();
  const tokenCount = tokenizer.encode(text).length; // default: WITH special tokens, matches what the model actually sees
  if (tokenCount > MODEL_MAX_TOKENS) {
    console.warn(
      `synapse: un texte de ${tokenCount} tokens dépasse la limite du modèle (${MODEL_MAX_TOKENS}) ` +
        `et sera tronqué par le modèle — ne devrait pas arriver si le texte vient de ` +
        `chunkFileForEmbedding(). À investiguer si ce message apparaît.`,
    );
  }

  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}
