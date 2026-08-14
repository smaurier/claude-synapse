---
description: Recherche sémantique dans le hub mémoire Synapse
disable-model-invocation: true
allowed-tools: [Bash]
---

# /brain-search

Recherche sémantique locale dans le hub mémoire de l'utilisateur (modèle d'embedding local,
rien n'est envoyé à un tiers).

1. Exécuter :
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/dist/commands/brainSearchCli.js" "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS
   ```
2. Si la commande échoue avec un message mentionnant `/synapse-init` : dire à l'utilisateur
   qu'aucun hub n'est encore configuré et qu'il faut lancer `/synapse-init` d'abord — ne pas
   afficher la trace d'erreur brute.
3. Sinon, présenter les résultats (chemin + score) de façon lisible. Si aucun résultat, le dire
   simplement plutôt que de laisser une sortie vide sans explication.
4. Le tout premier appel après l'installation du plugin peut prendre jusqu'à ~1 minute (le
   modèle d'embedding se télécharge et se met en cache localement) — si l'utilisateur s'interroge
   sur la lenteur, l'expliquer plutôt que de laisser deviner.
