---
description: Enregistre le chemin local d'un projet (sur ce poste) pour que metadata.cites puisse le résoudre — backlog 16/08, résout la question ouverte du n°8
allowed-tools: [Bash]
---

# /synapse-register-project

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/registerProjectRootCli.js" "${CLAUDE_PLUGIN_DATA}" <nom-projet> <chemin-absolu>
```

Enregistre dans `LocalConfig` (donc **propre à ce poste**, jamais synchronisé — un chemin
absolu appartient à une seule machine) le chemin local d'un projet. Une mémoire peut ensuite
citer du code via `metadata.cites: <nom-projet>/<chemin-relatif>` — `/brain-lint` et
`/synapse-doctor` résolvent ce nom pour vérifier si le code cité a bougé depuis l'écriture de
la mémoire (voir `checkCitedCodeDrift`, `docs/DESIGN.md`).

Si le nom n'est enregistré sur aucun poste, la vérification est simplement sautée pour ce
fichier-là — pas d'erreur bloquante, pas d'hypothèse "probablement à jour" par défaut.
