---
description: Crée un nouveau fichier mémoire avec le frontmatter conventionnel
disable-model-invocation: true
allowed-tools: [Bash]
---

# /brain-new <type> <nom>

Types valides : `user`, `feedback`, `project`, `reference`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/brainNewCli.js" "${CLAUDE_PLUGIN_DATA}" <type> <nom>
```

Après création, le fichier contient des `TODO` (description, contenu) — les remplir tout de
suite avec l'utilisateur plutôt que de laisser un fichier à moitié vide dans le hub. Si le
fichier existe déjà, proposer d'éditer l'existant plutôt que d'insister sur la création.
