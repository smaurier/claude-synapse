---
description: Consulte ou modifie la config partagée de Synapse (jamais d'édition manuelle de fichier)
allowed-tools: [Bash]
---

# /synapse-config

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseConfigCli.js" "${CLAUDE_PLUGIN_DATA}" show
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseConfigCli.js" "${CLAUDE_PLUGIN_DATA}" set <clé> <valeur>
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseConfigCli.js" "${CLAUDE_PLUGIN_DATA}" forget-machine <idPoste>
```

`show` (lecture seule) peut être lancé librement. **`set` et `forget-machine` modifient la config
partagée du hub — confirmation explicite obligatoire avant d'exécuter**, même si Claude a lui-même
suggéré le changement.

Sans argument après `/synapse-config`, faire `show`. Avec `<clé> <valeur>`, faire `set`. Avec
`forget-machine <idPoste>`, retirer un poste du registre.

**Clés modifiables par `set`** : `lockTimeoutMinutes`, `auditCadenceDays`, `wipLimit`
(nombres positifs) ; `refreshProjectsExclusions`,
`marketWatchExtraSources`, `refreshProjectsRoots` (listes séparées par des virgules). Les autres
champs sont gérés par le code lui-même (version du modèle d'embedding, date du dernier audit,
registre des postes) ou sont un marqueur de schéma (`version`). Si l'utilisateur demande une clé
non modifiable, expliquer pourquoi plutôt que d'afficher l'erreur brute.

**`forget-machine`** retire une entrée de `knownMachines`, le registre « qui utilise ce hub ».
À utiliser quand un poste est rendu ou décommissionné. `knownMachines` n'est volontairement pas
une clé de `set` : le registre est alimenté par le code à chaque SessionStart, pas saisi à la main.
Deux refus attendus, à relayer tels quels :

- **le poste courant** : le hook SessionStart le réinscrirait à la prochaine session, le retrait
  serait un faux succès. Le retirer depuis un autre poste.
- **un identifiant inconnu** : rien n'est retiré, et le message liste les postes connus (c'est
  une protection contre la faute de frappe, pas un échec à contourner).

Retirer un poste du registre est un geste de **ménage**, pas de sécurité : ça n'invalide aucune
clé. Si le poste était enrôlé dans un hub chiffré (`git-crypt`), il faut aussi retirer sa clé
publique et son blob — voir la checklist de rendu de poste.
