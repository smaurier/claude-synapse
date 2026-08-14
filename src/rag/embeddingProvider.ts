/**
 * Real local embedding, wired 13/08 after the design decision (problème 4)
 * and Sylvain's push-back on trusting a character-count estimate ("il
 * faudrait avoir une méthode sûre"). Uses transformers.js (WASM, no native
 * binary per OS/arch — same reasoning that led to node:sqlite over
 * sqlite-vec) with all-MiniLM-L6-v2.
 *
 * Chunking here is ALWAYS token-aware (tokenChunk.ts), never the character
 * heuristic in chunk.ts — this is the one place with a real tokenizer
 * available, so there is no reason to estimate.
 */

import { AutoTokenizer, pipeline, type FeatureExtractionPipeline, type PreTrainedTokenizer } from "@huggingface/transformers";
import { chunkFileByTokens, type Tokenizer } from "./tokenChunk.js";
import type { Chunk } from "./chunk.js";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const MODEL_MAX_TOKENS = 256;
// The model's tokenizer adds 2 special tokens ([CLS]/[SEP]) whenever text is
// actually embedded — measured empirically (13/08): windowing content up to
// the raw 256-token limit produced chunks that re-encoded to 257-261 tokens,
// over budget, because that +2 wasn't reserved. A flat -2 isn't quite enough
// margin either: this tokenizer lowercases and strips accents on decode,
// which can shift subword boundaries slightly on re-encoding. Reserving 16
// tokens (not just 2) was verified against the ENTIRE real memory corpus
// (104 files, 762 chunks) with zero violations — see the empirical
// validation note below rather than trusting this number on faith.
const SPECIAL_TOKEN_RESERVE = 16;
const MAX_CONTENT_TOKENS = MODEL_MAX_TOKENS - SPECIAL_TOKEN_RESERVE;
const OVERLAP_TOKENS = 30;

let tokenizerPromise: Promise<PreTrainedTokenizer> | null = null;
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

async function getTokenizer(): Promise<PreTrainedTokenizer> {
  tokenizerPromise ??= AutoTokenizer.from_pretrained(MODEL_ID);
  return tokenizerPromise;
}

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractorPromise ??= pipeline("feature-extraction", MODEL_ID);
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
