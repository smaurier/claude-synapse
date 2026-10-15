# Détection de doublons : remplacer la similarité cosinus

Statut : validé le 15/10/2026. Remplace la détection de « candidats de fusion »
par deux règles déterministes. Item 44 du backlog du plugin.

Les exemples de ce document sont anonymisés : le corpus qui a servi aux mesures
est un hub de mémoire privé. Les chiffres sont réels et inchangés.

## Le problème

La détection de candidats de fusion compare les fiches par similarité cosinus
d'embeddings. L'item 39 a montré, mesures à l'appui, que cet instrument ne sait
pas faire la différence entre « ces deux fiches disent la même chose » et « ces
deux fiches parlent de sujets voisins » :

- les paires que l'auteur du hub reconnaît comme réellement liées marquent 0,69
  à 0,83 ;
- des paires sans aucun rapport entre elles marquent 0,832 à 0,834 ;
- il n'existe donc aucun seuil qui sépare les deux populations.

La promesse attendue de la fonctionnalité est bien le dédoublonnage, décision de
l'auteur le 15/10 : quand le rapport sort une paire, il doit vouloir dire
« fusionne-les ». Le cosinus ne peut pas tenir cette promesse.

## Ce que la mesure dit du corpus

Deux mesures, faites avant toute décision d'implémentation, sur 222 fiches.

**Recouvrement verbatim.** Normalisation du corps (minuscules, accents,
markdown et ponctuation retirés), découpage en n-grammes de mots, comparaison
par containment (intersection divisée par la taille du plus petit ensemble) :

| Taille du n-gramme | Paires au-dessus de 0,05 | Paires au-dessus de 0,10 |
|---|---:|---:|
| 6 mots | 5 | 0 |
| 8 mots | 1 | 0 |
| 12 mots | 0 | 0 |

Le maximum observé est 0,076. Il n'y a pas de duplication par copier-coller
dans ce corpus.

**Collision de slug.** Même radical de nom de fichier, préfixe de type
différent (`project_x.md` et `reference_x.md`) : **1 paire**, et c'est le seul
vrai doublon que l'auteur avait identifié à la main. Zéro faux positif.

Conclusion : sur ce corpus, la bonne réponse de ce check est 1 paire, pas 59.
L'instrument qui la trouve tient en quinze lignes et n'a pas besoin de modèle.

## Décision

Remplacer la détection par similarité par `findDuplicateCandidates`, qui
applique deux règles indépendantes et déterministes.

### Règle A, collision de slug

Deux fiches distinctes dont le nom de fichier donne le même radical après
retrait du préfixe de type sont un doublon probable : elles traitent le même
sujet sous deux étiquettes. Le radical est normalisé en retirant les
séparateurs (`-` et `_`), les préfixes reconnus étant ceux des types de la
convention, dans leurs deux orthographes (`project_` et `project-`).

La règle ne porte donc **pas** sur « deux types différents », formulation
d'abord retenue puis corrigée en relecture : comme la convention tolère les
deux séparateurs, `project_une_chose.md` et `project-une-chose.md` sont deux
fichiers distincts au même radical et au même type. C'est un doublon, et une
règle fondée sur la différence de type l'aurait manqué. Le critère est donc :
regrouper par radical normalisé, signaler tout groupe de plus d'un fichier.

Les fiches sans préfixe de type reconnu ne participent pas à cette règle,
conformément à ce qui a été mesuré.

Rend 1 paire sur le corpus mesuré. C'est la règle qui porte la valeur.

### Règle B, recouvrement verbatim

n-grammes de 8 mots, containment supérieur ou égal à 0,30.

Rend 0 paire sur le corpus mesuré, et c'est assumé : c'est le seul instrument
capable d'attraper « le même fait réécrit », et le seuil est calibré sur la
mesure, le maximum observé sur une paire non-doublon étant 0,076, soit un
facteur quatre de marge. Elle existe comme garde-fou de régression, pas comme
source de suggestions quotidiennes.

## Invariants conservés

Ils viennent du code existant et ne changent pas :

- `metadata.protected: true` exclut une fiche de tout appariement, avant tout
  calcul. Une mémoire délibérément singulière ne doit jamais être proposée en
  fusion.
- Une paire déjà liée par `metadata.superseded_by` est écartée : sa relation
  est déjà nommée et résolue.
- Les fichiers d'index (`MEMORY.md` et `MEMORY-*.md`) sont écartés : un
  sommaire ressemble à tout ce qu'il liste, et « fusionner l'index dans une
  fiche » n'est pas une action qui existe.
- Rien n'est jamais fusionné automatiquement. Le rapport suggère, l'humain
  décide.

## Ce qui est retiré

- `findMergeCandidates` et `findMergeCandidatesGuarded`, donc la comparaison
  par paire en O(n²), son garde-fou de taille et son plafond de suggestions.
- L'appel au modèle d'embedding dans `runBrainLint` et `synapseDoctor`. Dans
  ces deux chemins, le modèle ne servait qu'à cette détection. L'index RAG et
  la recherche passent par `production.ts` et `searchHub.ts`, qui ne sont pas
  touchés.

Conséquence mesurable : les deux rapports deviennent entièrement
déterministes et sans modèle. La détection coûtait environ 145 secondes de
calcul sur le corpus mesuré.

## Le rapport annonce l'absence

Quand aucune des deux règles ne trouve rien, le rapport le dit explicitement
plutôt que de rester muet, par la même doctrine que le garde-fou de taille
qu'il remplace : ne jamais rendre un vide qui se lit « rien trouvé » quand il
peut vouloir dire « pas vérifié ».

## Critère falsifiable

Sur le hub de référence :

1. exactement 1 paire rendue, la collision de slug connue ;
2. aucun appel au modèle d'embedding pendant `/brain-lint` ;
3. le rapport nomme la règle qui a déclenché, pour que la suggestion soit
   lisible sans rouvrir le code.

Contrairement au critère de l'item 39, celui-ci est atteignable : il a été
établi à partir de la mesure, pas avant elle.

## À vérifier pendant l'implémentation

Retirer la machinerie rend `mergeCandidatesMaxFiles` inutile dans
`SharedConfig`. Si la lecture de configuration rejette les clés inconnues,
retirer la clé casserait les configurations existantes. Dans ce cas la clé
reste acceptée et ignorée pendant une version, avec une note de dépréciation.

## Tests

En TDD, rouge observé avant chaque implémentation.

Règle A : deux fiches de types différents au même radical forment une paire ;
deux fiches du même type au même radical mais au séparateur différent en
forment une aussi ; deux fiches au radical différent n'en forment pas ; une
fiche ne se compare jamais à elle-même ; une fiche sans préfixe de type
reconnu ne participe pas à la règle.

Règle B : deux corps partageant un long passage mot pour mot forment une
paire ; deux corps au vocabulaire proche mais sans passage commun n'en forment
pas ; le frontmatter ne compte jamais dans la comparaison ; une fiche réduite à
son frontmatter ne forme aucune paire.

Invariants : `protected` exclut, `superseded_by` écarte, l'index est écarté.

Rapport : l'absence de doublon produit une ligne explicite.
