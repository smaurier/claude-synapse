---
description: Veille GitHub sur les plugins concurrents — rapport seulement
allowed-tools: [Bash]
---

# /synapse-market-watch

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/marketWatchCli.js"
```

Lecture seule (API GitHub publique, sans authentification) — ne modifie jamais rien, aucune
action. Présenter le rapport tel quel : suivi des concurrents connus + nouveaux entrants
possibles trouvés par recherche de mots-clés (des faux positifs sont normaux, laisser
l'utilisateur juger).
