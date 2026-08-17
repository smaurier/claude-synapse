---
description: Audit sémantique d'une mémoire ou d'un petit groupe de mémoires — contradictions, données mortes, repérabilité, découpage, rechute. Invoqué à la demande, jamais automatique.
allowed-tools: [Read, Grep, Glob, Bash]
---

# /brain-audit

Complément de `/brain-lint`, pas un remplaçant. `/brain-lint` est déterministe (frontmatter,
péremption, similarité RAG) — sciemment limité à ça, parce qu'un vrai jugement sémantique ne
peut pas être fait honnêtement par du pattern-matching (voir `docs/DESIGN.md`). `/brain-audit`
assume l'inverse : c'est **Claude qui juge**, pas un algorithme qui prétend le faire. D'où deux
règles non négociables :

- **Jamais automatique.** Ne tourne que sur invocation explicite, jamais dans `/synapse-doctor`
  ni un hook. Un jugement sémantique appliqué à l'aveugle sur tout un corpus, sans qu'un humain
  ait demandé cette relecture précise, coûte cher (temps, tokens) et risque des faux verdicts à
  l'échelle.
- **Rapport seulement.** Comme `/brain-lint` : jamais de fusion, suppression, ou réécriture sans
  confirmation explicite de l'utilisateur pour chaque changement proposé.

## Portée

Sur un ou plusieurs fichiers désignés par l'utilisateur (`$ARGUMENTS` — noms, motif, ou "tout le
hub" explicitement demandé). Ne jamais partir tout seul sur l'intégralité d'un gros corpus sans
qu'on te l'ait demandé : lire N fichiers pour un vrai jugement sémantique coûte du contexte, ce
n'est pas un `grep`.

## Les cinq critères

Passer chaque fichier concerné par ceux qui s'appliquent — tous ne s'appliquent pas à chaque
fichier, ne pas forcer un verdict qui ne colle pas.

**1. Contradiction.** Est-ce que ce fichier affirme quelque chose d'incompatible avec un autre
fichier que tu approuves aussi ? Cas piège à chercher spécifiquement : une "leçon apprise" qui
n'est en réalité que la même erreur reformulée avec un vocabulaire plus mûr — pas une vraie
évolution, une redite. Si trouvé : présenter les deux fichiers côte à côte et demander lequel
fait foi, ne jamais trancher seul.

**2. Donnée morte.** Question test : *si l'utilisateur relit ce fichier dans six mois, son
comportement futur change-t-il vraiment ?* Si la réponse honnête est non, candidat à la
suppression (jamais silencieuse — proposer, expliquer pourquoi). Un "insight" doit être
rattaché à un événement réel concret (une erreur commise, une décision prise, une situation
vécue) — un constat général sans ancrage réel sonne profond mais ne sert à rien au rappel.

**3. Repérabilité.** Synapse n'impose pas de structure figée (pas d'arborescence parent/enfant
obligatoire) — la repérabilité passe par la `description` en frontmatter (ce qui décide de la
pertinence au recall) et les `[[wikilinks]]` vers les fichiers liés. Vérifier : la description
décrit-elle vraiment *quand* ce fichier doit remonter, ou est-elle trop vague pour guider une
recherche ? Les fichiers étroitement liés se référencent-ils mutuellement, ou un fichier
important reste-t-il orphelin (jamais cité par aucun autre) ?

**4. Découpage.** `/brain-lint` signale une taille/structure suspecte par heuristique — ici,
juger pour de vrai : ce fichier mélange-t-il plusieurs idées vraiment indépendantes qu'aucune
`description` ne peut honnêtement couvrir à la fois ? Si oui, proposer une scission précise
(quel contenu va où), pas juste "ce fichier est trop long".

**5. Rechute.** Si plusieurs fichiers décrivent une leçon similaire, ou si le même type d'erreur
revient : avant de proposer une nouvelle synthèse, chercher d'abord si un remède a déjà été
tenté pour ce problème précis et a échoué. Si oui, la vraie question n'est pas "quelle est la
leçon" mais "pourquoi le remède précédent n'a pas tenu" — proposer une nouvelle leçon qui ignore
cet échec risque de répéter le même résultat.

## Rapport

Un constat par fichier concerné, avec le critère qui s'applique et le raisonnement — pas
juste un verdict binaire. Terminer par une liste d'actions proposées, chacune nécessitant une
confirmation explicite avant d'être exécutée.
