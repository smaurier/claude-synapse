---
description: Audite la santé de la hiérarchie mémoire (frontmatter, péremption, doublons probables, candidats division) — rapport seulement
allowed-tools: [Bash]
---

# /brain-lint

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/runBrainLintCli.js" "${CLAUDE_PLUGIN_DATA}"
```

**Rapport seulement, jamais d'exécution automatique.** Ne jamais fusionner, diviser, ou
supprimer un fichier mémoire soi-même sur la base de ce rapport — le proposer à l'utilisateur et
attendre sa confirmation. Un mauvais merge peut fondre deux faits distincts en silence, plus
risqué qu'un lien qui traîne.

Les candidats "division" et "journal narratif" sont des heuristiques (longueur/structure), pas
des certitudes — les présenter comme des pistes à vérifier, pas des verdicts.

Les doublons probables viennent de deux règles déterministes, sans appel modèle. La règle A
regroupe par **radical normalisé** — le nom de fichier sans préfixe de type ni séparateur — et
signale tout groupe de plus d'une fiche, qu'il s'agisse de deux préfixes de type différents (ex.
`project_x.md` et `reference_x.md`) ou du même préfixe écrit avec l'autre séparateur (ex.
`project_une_chose.md` et `project-une-chose.md` — même radical, même type, deux fichiers
distincts). La règle B est un recouvrement verbatim (deux fiches partageant un passage d'au moins
huit mots consécutifs — signe d'un copier-coller). Le rapport est déterministe d'un bout à l'autre
et ne fait aucun appel au modèle d'embedding.

Les préfixes reconnus par la règle A sont ceux de la convention mémoire — `project`, `reference`,
`feedback`, `user` — dans leurs deux orthographes (`_` et `-`). Une fiche sans préfixe reconnu ne
participe pas à cette règle : un hub qui nomme ses fichiers autrement verra la règle A toujours
rendre « aucun doublon détecté », ce qui veut dire « non applicable à ces noms de fichiers », pas
« corpus vérifié propre ».
