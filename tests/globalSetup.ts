/**
 * Sonde unique du modèle d'embeddings, ajoutée 01/10/2026.
 *
 * Problème constaté : les 8 fichiers *.integration.test.ts téléchargent le
 * modèle depuis le CDN HuggingFace au moment du test. Sur une machine hors
 * ligne ou derrière un proxy filtrant, ils échouent tous en
 * `ConnectTimeoutError` — 21 tests rouges qui ne disent rien sur le code.
 * Ironie relevée en audit : Synapse revendique la résilience hors ligne
 * ("Hub unreachable → nothing to reconcile") mais sa suite de tests ne
 * tournait pas hors ligne.
 *
 * Deux effets, d'une seule sonde :
 *
 *  1. Elle CHAUFFE LE CACHE. transformers.js mémorise le modèle sur disque ;
 *     en le chargeant une fois ici, avant que vitest ne forke ses workers,
 *     les 8 fichiers d'intégration repartent du cache au lieu de négocier
 *     chacun son propre téléchargement. C'est aussi ce qui rendait la suite
 *     si lente (488 s mesurées le 01/10).
 *
 *  2. Elle DÉCIDE DU SKIP. Si le modèle est injoignable, on marque
 *     SYNAPSE_MODEL_AVAILABLE=0 et les fichiers d'intégration se marquent
 *     "skipped" au lieu d'échouer (voir tests/helpers/model.ts).
 *
 * Garde-fou essentiel : en CI, SYNAPSE_REQUIRE_MODEL=1 fait LEVER la sonde
 * au lieu de dégrader en skip. Sans ça, une panne de CDN ou une régression
 * de chargement de modèle passerait pour une CI verte — un test qui se
 * désactive tout seul en silence est pire que pas de test du tout.
 *
 * globalSetup tourne dans le process principal, AVANT le fork des workers :
 * les variables posées ici sont donc héritées par chaque worker.
 */

import { embedLocal } from "../src/rag/embeddingProvider.js";

// Le premier chargement télécharge ~120 Mo (poids q8) sur un cache froid.
const PROBE_TIMEOUT_MS = 300_000;

export default async function setup(): Promise<void> {
  const required = process.env.SYNAPSE_REQUIRE_MODEL === "1";

  try {
    await withTimeout(embedLocal("sonde de disponibilité du modèle"), PROBE_TIMEOUT_MS);
    process.env.SYNAPSE_MODEL_AVAILABLE = "1";
  } catch (err) {
    if (required) {
      throw new Error(
        `synapse: le modèle d'embeddings est injoignable alors que SYNAPSE_REQUIRE_MODEL=1 ` +
          `(CI). Les tests d'intégration ne peuvent pas être dégradés en skip ici. ` +
          `Cause : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    process.env.SYNAPSE_MODEL_AVAILABLE = "0";
    console.warn(
      `\nsynapse: modèle d'embeddings injoignable — les tests d'intégration seront ignorés.\n` +
        `         Les tests unitaires, eux, tournent normalement (ils n'ont jamais eu besoin du modèle).\n` +
        `         Pour exiger le modèle malgré tout : SYNAPSE_REQUIRE_MODEL=1 npm test\n` +
        `         Cause : ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`sonde du modèle non résolue en ${ms} ms`)), ms).unref(),
    ),
  ]);
}
