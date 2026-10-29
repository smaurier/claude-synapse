/**
 * Suppression récursive robuste sous Windows, extraite 01/10/2026 après un
 * `EPERM: Permission denied` reproductible sur le teardown de
 * rag-searchHub.integration.test.ts.
 *
 * Cause : sous Windows, la fermeture d'un handle (ici le `index.sqlite` du
 * VectorStore, plus les poids du modèle mappés par transformers.js) n'est pas
 * synchrone du point de vue du système de fichiers — le descripteur peut
 * survivre quelques dizaines de millisecondes au `close()`, et l'antivirus ou
 * l'indexeur Windows peut rouvrir le fichier dans cet intervalle. Un
 * `rmSync` immédiat échoue alors en EPERM/EBUSY, là où le même code réussit
 * silencieusement sous Linux — ce qui rendait l'échec invisible en CI
 * (ubuntu-latest uniquement jusqu'au 01/10).
 *
 * `maxRetries`/`retryDelay` sont la réponse prévue par Node pour exactement
 * ce cas (documentés comme « Windows only » sur fs.rm). On ne retente pas
 * nous-mêmes : la boucle est dans libuv, elle gère aussi ENOTEMPTY.
 */

import { rmSync } from "node:fs";

/**
 * Complément du 29/10/2026 : les 500 ms de la boucle libuv (10 × 50 ms) ne
 * suffisent pas quand le dossier est tenu non par un handle qui se ferme, mais
 * par un PROCESSUS ENFANT encore vivant. Mesuré sur
 * commands-synapseDoctor.integration.test.ts, qui lance le vrai contrôle de
 * dépendances : `npm` garde le répertoire courant ouvert plusieurs secondes, et
 * le teardown tombait en `EPERM` en suite complète alors que le même test passe
 * seul. L'assertion, elle, réussissait : seul le ménage échouait.
 *
 * Le nettoyage d'un dossier temporaire est donc traité comme ce qu'il est, un
 * best-effort : on retente plus longtemps, puis on abandonne en silence plutôt
 * que de faire échouer un test vert sur du ménage. Le système nettoie `%TEMP%`
 * de son côté.
 *
 * ⚠️ La cause profonde reste ouverte : un test ne devrait pas rendre la main
 * avant la fin du processus qu'il a lancé. À traiter côté attente de fin de
 * processus, pas ici.
 */
export function rmTree(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
  } catch {
    // Volontairement silencieux : voir le commentaire ci-dessus.
  }
}
