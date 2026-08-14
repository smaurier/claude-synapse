---
description: Initialise Synapse — clone/lie le hub mémoire git de l'utilisateur au projet courant
allowed-tools: [Bash]
---

# /synapse-init

Première configuration de Synapse pour cette machine et ce projet. Sûr à relancer (idempotent) :
un deuxième appel ne recrée rien qui est déjà correct.

**Peut être proposé de sa propre initiative** (l'utilisateur exprime vouloir commencer à
utiliser Synapse, sans connaître la commande exacte), mais **confirmation explicite obligatoire
avant d'exécuter** la commande elle-même — recueillir l'URL et le chemin (étapes 1 et 3)
constitue déjà une bonne part de cette confirmation, mais ne pas lancer sans un accord clair.

1. Si l'utilisateur n'a pas déjà donné l'URL de son hub git dans ce message, la demander
   explicitement. **Suggérer la forme HTTPS par défaut** (`https://github.com/<user>/<repo>.git`),
   pas SSH (`git@github.com:...`) : SSH exige une clé déjà configurée sur ce poste précis, qui
   n'existe pas forcément, alors que HTTPS réutilise souvent des identifiants déjà en place
   (`gh` CLI, Git Credential Manager) sans rien à configurer. Si le clonage échoue en `Permission
   denied (publickey)` malgré tout, c'est le signal qu'il fallait HTTPS depuis le départ — le
   proposer immédiatement plutôt que de creuser la configuration SSH. Ne jamais deviner l'URL
   elle-même.

2. La commande vérifie elle-même la visibilité du hub sur GitHub et **refuse d'initialiser**
   si le dépôt est public — inutile de le demander à l'utilisateur pour un hub GitHub. Pour un
   hébergeur autre que GitHub (GitLab, Bitbucket, self-hosted), la vérification automatique est
   impossible : la commande le signale explicitement dans son résultat, à relayer tel quel à
   l'utilisateur (lui demander de vérifier manuellement que le dépôt est privé).

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
