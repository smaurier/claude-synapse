/**
 * Porte d'entrée des tests qui ont besoin du vrai modèle d'embeddings.
 *
 * `describeWithModel` remplace `describe` dans les *.integration.test.ts :
 * le bloc est ignoré, avec une raison lisible, quand tests/globalSetup.ts
 * n'a pas réussi à joindre le modèle. En CI (SYNAPSE_REQUIRE_MODEL=1) le
 * globalSetup lève avant d'arriver ici — ce skip ne peut donc jamais
 * masquer une régression en intégration continue, uniquement épargner un
 * développeur hors ligne.
 *
 * Volontairement une constante et non une fonction : vitest décide des skips
 * au moment de la COLLECTE, avant d'exécuter quoi que ce soit d'asynchrone.
 * La valeur doit donc être connue à l'évaluation du module.
 */

import { describe } from "vitest";

export const modelAvailable = process.env.SYNAPSE_MODEL_AVAILABLE !== "0";

export const describeWithModel = describe.skipIf(!modelAvailable);
