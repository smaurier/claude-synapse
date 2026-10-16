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
import { AutoTokenizer, pipeline } from "@huggingface/transformers";
import { chunkFileByTokens } from "./tokenChunk.js";
import { readSharedConfig, writeSharedConfig } from "../config/config.js";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
export const DEFAULT_MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const MODEL_ID = DEFAULT_MODEL_ID;
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
let tokenizerPromise = null;
let extractorPromise = null;
async function getTokenizer() {
    tokenizerPromise ??= AutoTokenizer.from_pretrained(MODEL_ID);
    return tokenizerPromise;
}
async function getExtractor() {
    // dtype: "q8" — measured 14/08: the default (fp32) weights are 470MB and
    // took ~5min to download; the int8-quantized variant is ~120MB and loads
    // in ~50s. A plugin meant to stay light shouldn't default to the heavy
    // variant. Same 384-dim output; not re-validated for embedding-quality
    // loss vs fp32 (quantization is a known, generally small trade-off for
    // sentence-similarity tasks, but that's an assumption, not measured here).
    extractorPromise ??= pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
    return extractorPromise;
}
function toTokenizerAdapter(tokenizer) {
    return {
        // add_special_tokens: false — the windowing budget (MAX_CONTENT_TOKENS)
        // is a content-only budget; the +2 [CLS]/[SEP] get added back by the
        // real embedding call later, and are already reserved for.
        encode: (text) => tokenizer.encode(text, { add_special_tokens: false }),
        decode: (ids) => tokenizer.decode(ids, { skip_special_tokens: true }),
    };
}
/** Token-aware chunking backed by the real model's tokenizer — chunk
 *  boundaries are exact, not estimated from a chars-per-token ratio. */
export async function chunkFileForEmbedding(path, content) {
    const tokenizer = await getTokenizer();
    return chunkFileByTokens(path, content, toTokenizerAdapter(tokenizer), MAX_CONTENT_TOKENS, OVERLAP_TOKENS);
}
/**
 * Embeds one chunk of text. Includes a defensive check even though
 * chunkFileForEmbedding() should make it unreachable: if a chunk somehow
 * still exceeds the model's window (e.g. called directly with unchunked
 * text), warn loudly instead of letting the model truncate in silence.
 */
export async function embedLocal(text) {
    const tokenizer = await getTokenizer();
    const tokenCount = tokenizer.encode(text).length; // default: WITH special tokens, matches what the model actually sees
    if (tokenCount > MODEL_MAX_TOKENS) {
        console.warn(`synapse: un texte de ${tokenCount} tokens dépasse la limite du modèle (${MODEL_MAX_TOKENS}) ` +
            `et sera tronqué par le modèle — ne devrait pas arriver si le texte vient de ` +
            `chunkFileForEmbedding(). À investiguer si ce message apparaît.`);
    }
    const extractor = await getExtractor();
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
}
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
export function ensurePinnedEmbeddingModel(hubClonePath) {
    const shared = readSharedConfig(hubClonePath);
    if (shared.ragEmbeddingModelVersion === "unset") {
        writeSharedConfig(hubClonePath, { ...shared, ragEmbeddingModelVersion: DEFAULT_MODEL_ID });
        return DEFAULT_MODEL_ID;
    }
    if (shared.ragEmbeddingModelVersion !== DEFAULT_MODEL_ID) {
        throw new Error(`synapse: modèle d'embedding épinglé ("${shared.ragEmbeddingModelVersion}") différent du seul ` +
            `modèle actuellement supporté ("${DEFAULT_MODEL_ID}") — changer de modèle demande un ré-embedding ` +
            `complet du corpus, pas encore automatisé. Revenir à "${DEFAULT_MODEL_ID}" dans la config partagée, ` +
            `ou construire la migration avant de continuer.`);
    }
    return DEFAULT_MODEL_ID;
}
/**
 * Reads the @huggingface/transformers version actually installed on disk,
 * straight from ITS OWN package.json — not from this plugin's package.json
 * dependency range (e.g. "^4.3.1"), which says what was ALLOWED at install
 * time, not what `npm install` actually resolved.
 *
 * The obvious one-liner, `require.resolve("@huggingface/transformers/package.json")`,
 * does not work: this library's own package.json restricts "exports" to its
 * dist bundles only, no "./package.json" subpath, so Node refuses that
 * resolution outright (confirmed by hand 16/10/2026 against the installed
 * 4.3.1 — it throws ERR_PACKAGE_PATH_NOT_EXPORTED). So instead this resolves
 * the package's real ENTRY point (which IS exported) and walks up from
 * there until it finds a package.json naming this package — robust to the
 * exact dist/ layout changing between versions, which the first approach
 * was not.
 *
 * Never throws, and returns `null` — NOT a placeholder string — when the
 * version cannot be determined. That distinction matters downstream (see
 * getEmbedderIdentity and rebuildIfStale in search.ts): a transient read
 * failure (partially restored node_modules, a permissions hiccup, an
 * antivirus holding the file open) must not be treated as "the identity
 * changed", or a machine flipping between a real version and a placeholder
 * would clear and re-embed the whole corpus on every flip — far more
 * expensive than the problem this guard prevents. `null` lets the caller
 * abstain instead of guessing.
 */
function readInstalledTransformersVersion() {
    try {
        const require = createRequire(import.meta.url);
        let dir = dirname(require.resolve("@huggingface/transformers"));
        // Bounded walk, not a loop to the filesystem root: six levels is far
        // more than node_modules/@huggingface/transformers/dist ever needs, and
        // a bound means a pathological resolution can't hang this function.
        for (let i = 0; i < 6; i++) {
            try {
                const raw = readFileSync(join(dir, "package.json"), "utf8");
                const pkg = JSON.parse(raw);
                if (pkg.name === "@huggingface/transformers" && typeof pkg.version === "string") {
                    return pkg.version;
                }
            }
            catch {
                // No package.json at this level, or it didn't parse — keep walking
                // up; the loop bound below is what prevents this from running away.
            }
            const parent = dirname(dir);
            if (parent === dir)
                break; // reached the filesystem root
            dir = parent;
        }
    }
    catch {
        // require.resolve() itself failed (library missing/renamed on disk) —
        // fall through to null below rather than throwing.
    }
    return null;
}
/**
 * The embedder's full identity: the pinned MODEL id (DEFAULT_MODEL_ID,
 * guarded by ensurePinnedEmbeddingModel above) says WHAT is asked for, but
 * says nothing about the LIBRARY VERSION that actually turns text into
 * vectors — a tokenizer or pooling change in @huggingface/transformers
 * itself would move the stored vectors without the model id ever changing.
 *
 * Measured by hand 16/10/2026 for the 4.2.0 -> 4.3.1 bump: max per-dimension
 * delta was 1.3e-8 (pure float noise — the index stayed valid that time).
 * Nobody will redo that measurement by hand at the next bump, hence this:
 * VectorStore.getEmbedderIdentity()/setEmbedderIdentity() record this string
 * alongside the index, and rebuildIfStale() (search.ts) forces a full
 * re-embed the moment it changes — including a change on EITHER half, model
 * or library — instead of a silent, unmeasured drift in search quality.
 *
 * Returns `null` when the library version is unverifiable right now (see
 * readInstalledTransformersVersion). rebuildIfStale treats `null` as "say
 * nothing" rather than "something changed" — see its own doc comment for
 * why a guard that can't verify must abstain, not guess.
 */
export function getEmbedderIdentity() {
    const version = readInstalledTransformersVersion();
    if (version === null)
        return null;
    return `${DEFAULT_MODEL_ID}@${version}`;
}
//# sourceMappingURL=embeddingProvider.js.map