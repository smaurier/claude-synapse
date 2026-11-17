/**
 * Everything about the embedder that can be answered WITHOUT loading
 * @huggingface/transformers: which model is pinned, which library version is
 * installed, where the model files live.
 *
 * Split out of embeddingProvider.ts on 17/11/2026: importing that module
 * costs 0.75 to 1 s (measured) even when no model is ever loaded, and the
 * Stop hook pays it at every end of turn to find out the corpus has not
 * changed. Nothing here may import embeddingProvider.ts or the library
 * (tests/refreshIndex-unchanged-corpus.test.ts counts the loads).
 */
export declare const DEFAULT_MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
/**
 * Backlog 53 (17/10/2026). Par défaut transformers.js range le modèle
 * téléchargé (130 Mo) dans node_modules/@huggingface/transformers/.cache,
 * c'est-à-dire DANS le cache de version du plugin. Chaque `claude plugin
 * update` crée un nouveau dossier de version, donc re-téléchargeait le modèle
 * au premier rappel proactif : 59 s mesurées, soit un timeout du hook
 * UserPromptSubmit (15 s) au premier prompt après chaque mise à jour, sur
 * chaque poste. ${CLAUDE_PLUGIN_DATA} survit aux mises à jour par contrat
 * (documenté), le modèle y vit désormais, sous models/.
 *
 * Même convention que defaultLocalConfigPath : dérivé du pluginDataDir passé
 * explicitement en argument CLI, jamais lu depuis process.env.
 */
export declare function defaultModelCacheDir(pluginDataDir: string): string;
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
export declare function getEmbedderIdentity(): string | null;
