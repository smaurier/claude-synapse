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

/** Équivalent de `rmSync(path, { recursive: true, force: true })`, mais qui ne casse pas sous Windows. */
export function rmTree(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
