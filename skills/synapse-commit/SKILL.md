---
description: Commite dans le hub mémoire UNIQUEMENT les fichiers nommés, sous verrou, puis pousse. À utiliser à la place de git add / git commit dès qu'on commite dans le hub
allowed-tools: [Bash]
---

# /synapse-commit -m "<message>" -- <chemin>...

Plusieurs sessions Claude partagent le même hub, le même index git. Un `git add -A` (ou
`git commit -a`) d'une session emporte les modifications en cours des autres, et `git log -1`
montre alors le commit d'un autre. Cette commande :

- ne commite **que les chemins nommés** (`git commit --only`), quoi que les autres sessions
  aient modifié ou indexé ;
- prend le verrou du hub (un processus à la fois, attente de 30 s max), comme la sync de fin de session ;
- **dit où est passé** un chemin qu'une autre session a déjà commité, au lieu d'un silence.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/commitPathsCli.js" "${CLAUDE_PLUGIN_DATA}" -m "<message>" -- <chemin1> <chemin2>
```

Chemins relatifs au hub, ou absolus (y compris via la jonction `.claude/memory` d'un projet).
Nommer exactement les fichiers que **cette** session a écrits, jamais un dossier entier par
commodité : c'est ce qui empêche d'emporter le travail d'une autre session.

Lire la sortie :
- `commité et poussé (<hash>)` : fait.
- `déjà dans l'historique, dernier commit qui le touche : <hash> <message>` : une autre session
  l'a emporté ; la modification **n'est pas perdue**, elle est dans ce commit. Le dire tel quel.
- `aucune modification et jamais commité` : chemin erroné, vérifier.
- `PAS poussé` : le distant a divergé, ne jamais forcer ; le signaler.
- secret détecté : ne jamais contourner, retirer le secret puis relancer.
