---
description: Désinstalle Synapse pour ce projet — retire le lien, garde le hub git intact
disable-model-invocation: true
allowed-tools: [Bash]
---

# /synapse-uninstall

Quasi non-destructif par construction : retire le lien mémoire de ce projet et la config locale
de ce poste, ne touche jamais au hub git lui-même (ni son contenu, ni le clone local — c'est un
vrai dépôt git, pas un artefact jetable). Ne gère qu'un seul projet à la fois, comme
`/synapse-init`.

1. Exécuter :
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseUninstallCli.js" "${CLAUDE_PLUGIN_DATA}" <linkPath>
   ```
2. Rapporter le résultat tel quel. Si rien n'était installé, le dire simplement (pas une erreur).
