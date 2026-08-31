---
description: Radar de synchro git — au SessionStart et à la demande, vérifie chaque dépôt surveillé et alerte si local/remote ont divergé (rien pull, rien push automatique)
allowed-tools: [Bash]
---

# /synapse-sync-status

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/syncStatusCli.js" "${CLAUDE_PLUGIN_DATA}"
```

Alerte seulement, jamais d'action automatique (pas de pull, pas de push). Le hook
SessionStart émet une ligne du type :

```
SYNC STATUS: 3 ok · rgaa-private ⬇3 · brain divergence (1↑/2↓) · claude-synapse ⬆1
```

Codes :
- `N ok` : dépôts alignés avec leur remote
- `⬇N` : `N` commits derrière (à `git pull`)
- `⬆N` : `N` commits d'avance non poussés
- `divergence (A↑/B↓)` : HEAD n'est pas ancêtre de `origin/*` — réconciliation manuelle
- `?` : erreur (pas de remote, dépôt inaccessible, timeout du fetch)

## Configurer les dépôts surveillés

Le premier run crée `sync-watch.json` dans le dossier de données Synapse. Éditer
pour lister les dépôts à surveiller :

```json
{
  "explicit": [
    { "name": "rgaa-private", "path": "C:/Users/sylva/Documents/projects/rgaa-formation" },
    { "name": "brain",        "path": "C:/Users/sylva/Documents/projects/brain" }
  ],
  "scanPaths": [
    "C:/Users/sylva/Documents/projects"
  ],
  "fromMemory": false,
  "blacklist": ["archived-repo"]
}
```

- `explicit` : liste nominative (permet un nom court différent du dossier)
- `scanPaths` : chaque dossier profondeur 1 contenant `.git` est surveillé
- `fromMemory` : (v1.1) extraction des dépôts référencés dans `MEMORY.md` — désactivé par défaut
- `blacklist` : noms à exclure de la liste finale

Les trois sources s'unissent (dédupliquées par chemin canonique), puis la blacklist filtre.

## Latence

Stratégie hybride : cache TTL 10 min. Si un dépôt a été vérifié il y a moins
de 10 minutes, on utilise le résultat mémorisé. Sinon `git fetch` avec timeout
5 s par dépôt (parallèle). Zéro fetch pour les dépôts sans upstream.

Le cache vit dans `${CLAUDE_PLUGIN_DATA}/sync-status-cache.json` — supprimable
à tout moment pour forcer un rafraîchissement.
