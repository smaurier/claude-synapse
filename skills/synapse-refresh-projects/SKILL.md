---
description: Lie la mémoire de tous les projets Claude Code trouvés sous une racine donnée
disable-model-invocation: true
allowed-tools: [Bash]
---

# /synapse-refresh-projects <rootDir>

Complète l'auto-liaison du projet courant (déjà faite à chaque `SessionStart`) pour les cas où
l'utilisateur veut lier plusieurs projets d'un coup — après avoir cloné plusieurs repos existants,
par exemple. Demander la racine à scanner si elle n'est pas donnée.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/runRefreshProjectsCli.js" "${CLAUDE_PLUGIN_DATA}" <rootDir>
```

Les exclusions (dossiers à ignorer sous cette racine) viennent de `/synapse-config` — les noms
de dossiers à exclure sont des correspondances exactes au premier niveau, pas des motifs.
