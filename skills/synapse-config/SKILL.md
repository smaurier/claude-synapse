---
description: Consulte ou modifie la config partagée de Synapse (jamais d'édition manuelle de fichier)
disable-model-invocation: true
allowed-tools: [Bash]
---

# /synapse-config

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseConfigCli.js" "${CLAUDE_PLUGIN_DATA}" show
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseConfigCli.js" "${CLAUDE_PLUGIN_DATA}" set <clé> <valeur>
```

Sans argument après `/synapse-config`, faire `show`. Avec `<clé> <valeur>`, faire `set`. Seules
`lockTimeoutMinutes` et `auditCadenceDays` sont modifiables — les autres champs sont gérés par
le code lui-même (version du modèle d'embedding, date du dernier audit) ou n'ont pas encore de
format tranché (exclusions). Si l'utilisateur demande une clé non modifiable, expliquer
pourquoi plutôt que de simplement afficher l'erreur brute.
