---
description: Désinstalle Synapse pour ce projet — retire le lien, garde le hub git intact
allowed-tools: [Bash]
---

# /synapse-uninstall

Quasi non-destructif par construction : retire le lien mémoire de ce projet et la config locale
de ce poste, ne touche jamais au hub git lui-même (ni son contenu, ni le clone local — c'est un
vrai dépôt git, pas un artefact jetable). Ne gère qu'un seul projet à la fois, comme
`/synapse-init`.

**Peut être proposé de sa propre initiative si le contexte s'y prête** (l'utilisateur exprime
vouloir arrêter d'utiliser Synapse pour ce projet), mais **confirmation explicite obligatoire
avant d'exécuter** — ne jamais lancer la commande seule, même si le déclencheur semble évident.

1. Exécuter (après confirmation) :
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseUninstallCli.js" "${CLAUDE_PLUGIN_DATA}" <linkPath>
   ```
2. Rapporter le résultat tel quel. Si rien n'était installé, le dire simplement (pas une erreur).
