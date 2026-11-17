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

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readSharedConfig, writeSharedConfig } from "../config/config.js";

export const DEFAULT_MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

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
export function defaultModelCacheDir(pluginDataDir: string): string {
  return join(pluginDataDir, "models");
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
export function ensurePinnedEmbeddingModel(hubClonePath: string): string {
  const shared = readSharedConfig(hubClonePath);
  if (shared.ragEmbeddingModelVersion === "unset") {
    writeSharedConfig(hubClonePath, { ...shared, ragEmbeddingModelVersion: DEFAULT_MODEL_ID });
    return DEFAULT_MODEL_ID;
  }
  if (shared.ragEmbeddingModelVersion !== DEFAULT_MODEL_ID) {
    throw new Error(
      `synapse: modèle d'embedding épinglé ("${shared.ragEmbeddingModelVersion}") différent du seul ` +
        `modèle actuellement supporté ("${DEFAULT_MODEL_ID}") — changer de modèle demande un ré-embedding ` +
        `complet du corpus, pas encore automatisé. Revenir à "${DEFAULT_MODEL_ID}" dans la config partagée, ` +
        `ou construire la migration avant de continuer.`,
    );
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
function readInstalledTransformersVersion(): string | null {
  try {
    const require = createRequire(import.meta.url);
    let dir = dirname(require.resolve("@huggingface/transformers"));
    // Bounded walk, not a loop to the filesystem root: six levels is far
    // more than node_modules/@huggingface/transformers/dist ever needs, and
    // a bound means a pathological resolution can't hang this function.
    for (let i = 0; i < 6; i++) {
      try {
        const raw = readFileSync(join(dir, "package.json"), "utf8");
        const pkg = JSON.parse(raw) as { name?: unknown; version?: unknown };
        if (pkg.name === "@huggingface/transformers" && typeof pkg.version === "string") {
          return pkg.version;
        }
      } catch {
        // No package.json at this level, or it didn't parse — keep walking
        // up; the loop bound below is what prevents this from running away.
      }
      const parent = dirname(dir);
      if (parent === dir) break; // reached the filesystem root
      dir = parent;
    }
  } catch {
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
export function getEmbedderIdentity(): string | null {
  const version = readInstalledTransformersVersion();
  if (version === null) return null;
  return `${DEFAULT_MODEL_ID}@${version}`;
}
