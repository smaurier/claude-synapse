/**
 * Backlog item 45 (15/10/2026, relevé par la revue de branche de l'item 44) :
 * `brainLint.ts` était devenu le plus gros fichier du dépôt — ces sept fonctions
 * (`slugStem`, `findSlugCollisions`, `comparableWords`, `shingles`, `containment`,
 * `findVerbatimOverlaps`, `findDuplicateCandidates`, plus `formatDuplicateCandidate`)
 * forment un module cohérent, déplacé ici tel quel le 01/11/2026 une fois la
 * décision prise (le constat avait explicitement attendu l'accord de Sylvain,
 * posé après le 23/10). Aucune logique n'a changé dans ce déplacement — seules
 * les frontières d'import ont bougé (`extractFrontmatter`, `isIndexFile` et
 * `VALID_TYPES` restent dans brainLint.ts, importés ici).
 */
/**
 * Décision délibérée (item 44) : les primitives ci-dessous (`slugStem`,
 * `findSlugCollisions`, `comparableWords`, `shingles`, `containment`,
 * `findVerbatimOverlaps`) sont exportées bien que seules `findDuplicateCandidates`
 * et `DuplicateCandidate` aient un consommateur en production — tout le reste
 * n'est atteint que par les tests. Choisi plutôt que dérivé : tester chaque
 * règle isolément a attrapé plusieurs défauts réels pendant ce travail, et les
 * consommateurs du plugin publié sont ses propres skills, pas des imports
 * externes — le coût d'une surface `.d.ts` plus large est donc faible ici.
 * `bodyWithoutFrontmatter`, plus bas, n'a aucun consommateur même en test ;
 * elle reste interne (pas d'`export`) pour cette raison précise.
 *
 * Le radical d'un nom de fiche (ci-dessous) : son nom de fichier sans préfixe
 * de type, sans séparateurs et en minuscules. `null` pour une fiche dont le
 * nom ne porte pas un préfixe de type reconnu, auquel cas la règle de
 * collision ne s'y applique pas. Également `null` pour un radical vide (ex.
 * `project_.md`), car il n'est pas utile pour la détection de collisions.
 */
export declare function slugStem(path: string): string | null;
/**
 * Une paire de fiches que l'une des deux règles signale comme doublon
 * probable, avec la preuve qui l'a fait sortir. La preuve est structurée et
 * non rédigée : c'est `formatDuplicateCandidate` qui compose la phrase, pas
 * les données elles-mêmes.
 */
export type DuplicateCandidate = {
    a: string;
    b: string;
    rule: "slug";
    stem: string;
} | {
    a: string;
    b: string;
    rule: "verbatim";
    containment: number;
    shingleSize: number;
};
/**
 * Rend la preuve structurée d'un `DuplicateCandidate` en une phrase lisible —
 * nomme toujours la règle qui a déclenché (critère falsifiable de la spec de
 * l'item 44). Narrowed sur `rule` plutôt que castée, pour qu'une troisième
 * règle future soit une erreur de compilation ici jusqu'à être prise en
 * compte. Partagée par les deux CLI (`runBrainLintCli.ts`, `synapseDoctorCli.ts`),
 * qui avaient chacune leur copie avant l'item 44 — déplacée ici pour être
 * testable, une entrée CLI ne pouvant pas être importée par un test.
 */
export declare function formatDuplicateCandidate(c: DuplicateCandidate): string;
/**
 * Règle A de l'item 44 : deux fiches distinctes au même radical traitent le
 * même sujet sous deux étiquettes. Mesurée sur le hub réel (222 fiches) : 1
 * paire, qui était le seul vrai doublon identifié à la main, zéro faux
 * positif. Les chemins sont triés pour que la paire soit stable d'une
 * exécution à l'autre.
 */
export declare function findSlugCollisions(paths: string[]): DuplicateCandidate[];
/**
 * Le texte tel qu'on le compare : minuscules, sans accents, sans code inline,
 * sans ponctuation ni marques markdown. L'ordre des opérations compte : le
 * backtick (U+0060) est classé Unicode diacritic=yes, donc il est supprimé par
 * le `.replace(/\p{Diacritic}/gu, "")` ; il faut ôter le code inline AVANT le
 * pass diacritique, sinon les backticks disparaissent sans emporter leur contenu.
 */
export declare function comparableWords(body: string): string[];
export declare function shingles(words: string[], size: number): Set<string>;
/** Intersection divisée par la taille du plus petit ensemble, et non Jaccard :
 *  une fiche courte entièrement absorbée dans une longue doit marquer 1, ce que
 *  Jaccard masquerait derrière la différence de taille. */
export declare function containment(a: Set<string>, b: Set<string>): number;
/**
 * Règle B de l'item 44 : recouvrement verbatim par n-grammes (shingles) de
 * mots. Deux fiches partageant un passage d'au moins huit mots consécutifs
 * signalent une possible duplication par copier-coller — le seul cas où deux
 * fiches distinctes partagent mot pour mot une séquence de ce genre.
 *
 * Mesuré sur le hub réel (222 fiches, 15/10/2026) : le recouvrement maximal
 * observé entre deux fiches quelconques était 0,076 à 8-grammes, et aucune
 * paire ne dépassait 0,10 à 6, 8 ou 12 mots — c'est cette stabilité d'une
 * taille de n-gramme à l'autre qui justifie le choix de 8, et pas seulement
 * le chiffre à 8. Le seuil 0,30 laisse un facteur 4 de marge au-dessus du
 * plancher observé.
 * Cette règle rend zéro paire aujourd'hui, et c'est assumé : elle existe
 * comme garde-fou de régression contre un futur copier-coller, pas comme
 * source de suggestions quotidiennes.
 *
 * Point faible connu : les shingles sont dédupliqués en Set, donc deux
 * fiches dominées par la même courte phrase répétée se réduisent à des
 * ensembles identiques minuscules et marquent 1.0 par répétition plutôt que
 * par passage partagé. Jamais observé sur un hub réel, mais reproductible à
 * volonté : `scripts/scale-test.mjs` génère justement des fiches de ce type
 * et fait donc sortir 100 % des paires. Un humain lit la suggestion, donc le
 * coût reste faible.
 *
 * Remplace l'ancien détecteur par embeddings (un appel modèle par chunk, et
 * non par fiche — c'est ce dépliage qui coûtait les ~145 s) :
 * ici, aucun appel modèle ni I/O, uniquement des opérations en mémoire sur
 * des sets (O(n²) de comparaisons brutes, ~24 000 sur 222 fiches, bon marché).
 */
export declare function findVerbatimOverlaps(files: {
    path: string;
    content: string;
}[]): DuplicateCandidate[];
/**
 * Point d'entrée pour les deux rapports de détection de doublons — applique
 * les deux règles déterministes (collision de slug, recouvrement verbatim)
 * et écarte les paires inéligibles en amont de toute comparaison, jamais en
 * filtrant le résultat après coup, pour que l'exclusion soit inconditionnelle.
 *
 * Remplace la comparaison O(n²) par embeddings de l'ancien `MergeCandidate`,
 * qui mesurait le registre d'écriture (les fiches feedback partagent un bloc
 * frontmatter et une convention rédactionnelle, pas un sujet) plutôt que la
 * vraie duplication.
 *
 * Trois exclusions, appliquées avant toute comparaison :
 * (1) `isIndexFile` : un index (MEMORY.md et sous-index) est une table des
 * matières qui liste toutes les fiches — il ressemble donc un peu à chacune
 * d'elles et ne peut jamais être fusionné utilement.
 * (2) `isProtected` : une fiche `metadata.protected: true` (garde-fou,
 * mémoire délibérément singulière) ne doit jamais être proposée en fusion,
 * quelle que soit la ressemblance de son contenu.
 * (3) `supersessionTarget` : une paire déjà liée par `metadata.superseded_by`
 * a sa relation déjà nommée et résolue — la signaler à nouveau est du bruit.
 */
export declare function findDuplicateCandidates(files: {
    path: string;
    content: string;
}[]): DuplicateCandidate[];
