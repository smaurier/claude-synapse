/**
 * Détection des binaires externes dont certains tests ont réellement besoin,
 * ajoutée 01/10/2026.
 *
 * `tests/git.test.ts` pilote de vrais `gpg` et `git-crypt` — choix délibéré et
 * assumé dans son en-tête ("same 'no mocking' bias as the rest of this file"),
 * qui n'est pas remis en cause ici : ces tests prouvent l'intégration avec les
 * binaires tels qu'ils se comportent vraiment, un mock ne prouverait rien.
 *
 * Ce qui est corrigé, c'est leur comportement quand le binaire est ABSENT :
 * ils échouaient en `spawnSync git-crypt ENOENT`, un échec rouge qui ne dit
 * rien sur le code. Ils se marquent désormais "skipped" avec une raison
 * lisible — même principe que tests/helpers/model.ts pour le modèle
 * d'embeddings.
 *
 * Garde-fou symétrique à celui du modèle : la CI pose
 * SYNAPSE_REQUIRE_GIT_CRYPT=1 sur la plateforme où le binaire est installé
 * (Linux), donc le skip ne peut jamais y masquer une régression. Sur
 * windows-latest le binaire n'est pas distribué par les gestionnaires de
 * paquets du runner : le skip y est le comportement voulu, pas un trou.
 */

import { describe } from "vitest";
import { execFileSync } from "node:child_process";

function binaryExists(bin: string): boolean {
  try {
    execFileSync(bin, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export const gitCryptAvailable = binaryExists("git-crypt") && binaryExists("gpg");

if (!gitCryptAvailable && process.env.SYNAPSE_REQUIRE_GIT_CRYPT === "1") {
  throw new Error(
    "synapse: git-crypt et/ou gpg sont absents alors que SYNAPSE_REQUIRE_GIT_CRYPT=1. " +
      "Les tests d'intégration git-crypt ne peuvent pas être dégradés en skip ici.",
  );
}

export const describeWithGitCrypt = describe.skipIf(!gitCryptAvailable);
