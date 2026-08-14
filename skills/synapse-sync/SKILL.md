---
description: Synchronise la mémoire maintenant (commit + push), en secours du hook automatique
allowed-tools: [Bash]
---

# /synapse-sync

Le hook `SessionEnd` fait déjà ça automatiquement en fin de session, mais Claude Code ne
garantit PAS qu'il ait le temps de se terminer avant que la session se ferme réellement
(événement non-bloquant, sans garantie de complétion). Cette commande est le filet de
sécurité manuel — à proposer si l'utilisateur veut être sûr qu'un changement est bien
synchronisé, ou si le hook a pu être coupé.

**Peut être proposé de sa propre initiative** (ex: après avoir aidé à créer/modifier plusieurs
mémoires), mais **confirmation explicite obligatoire avant d'exécuter** — ça pousse pour de vrai
sur le dépôt git distant de l'utilisateur, jamais sur la seule initiative de Claude.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/syncBrainCli.js" "${CLAUDE_PLUGIN_DATA}"
```

Si le résultat signale des secrets détectés : **ne jamais suggérer de contourner le blocage**
(pas de force-push, pas de désactivation du scan). Aider l'utilisateur à retirer le secret du
fichier concerné, puis relancer.
