---
description: Audite la santé de la hiérarchie mémoire (frontmatter, péremption, candidats fusion/division) — rapport seulement
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

Les doublons probables viennent de deux règles déterministes, sans appel modèle : une collision
de radical (deux fiches au même nom sous des préfixes de type différents, ex. `project_x.md` et
`reference_x.md`) et un recouvrement verbatim (deux fiches partageant un passage d'au moins huit
mots consécutifs — signe d'un copier-coller). Le rapport est déterministe d'un bout à l'autre et
ne fait aucun appel au modèle d'embedding.
