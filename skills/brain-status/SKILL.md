---
description: État rapide de Synapse pour ce projet (lien, taille du corpus, dernier audit)
disable-model-invocation: true
allowed-tools: [Bash]
---

# /brain-status

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/brainStatusCli.js" "${CLAUDE_PLUGIN_DATA}" <linkPath>
```

Vérification rapide, un seul projet. Pour un audit plus large (santé de toute la hiérarchie
mémoire, veille marché), c'est `/synapse-doctor` — pas cette commande.
