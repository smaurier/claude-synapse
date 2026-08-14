---
description: Initialise Synapse — clone/lie le hub mémoire git de l'utilisateur au projet courant
disable-model-invocation: true
allowed-tools: [Bash]
---

# /synapse-init

Première configuration de Synapse pour cette machine et ce projet. Sûr à relancer (idempotent) :
un deuxième appel ne recrée rien qui est déjà correct.

1. Si l'utilisateur n'a pas déjà donné l'URL de son hub git dans ce message, la demander
   explicitement (ex: `git@github.com:<user>/<repo>.git`). Ne pas deviner.

2. **Avant de continuer**, rappeler à l'utilisateur de vérifier que ce dépôt est **privé**.
   Rien ici ne le vérifie automatiquement pour l'instant (limite connue, pas cachée) — le
   scan de secrets protège le contenu, pas la visibilité du repo.

3. Déterminer où lier la mémoire pour CE projet. Par défaut, proposer un sous-dossier du projet
   courant (ex: `./memory` à la racine du projet) et confirmer avec l'utilisateur plutôt que
   d'imposer un chemin. La détection automatique multi-projets (un hub, plusieurs projets liés
   sans qu'on ait à le redemander à chaque fois) n'est pas encore construite — cette commande ne
   configure qu'un seul projet à la fois pour l'instant.

4. Exécuter :
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseInitCli.js" "${CLAUDE_PLUGIN_DATA}" <hubUrl> <linkPath>
   ```

5. Rapporter le résultat tel quel à l'utilisateur (déjà lié / créé / recréé / sauvegarde
   effectuée à tel endroit). Si ça échoue, montrer le message d'erreur — il est déjà pensé pour
   être lisible (diagnostic + cause probable), pas une trace brute à retraiter.
