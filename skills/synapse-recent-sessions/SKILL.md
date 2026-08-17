---
description: Liste tes sessions Claude Code récentes (date, titre, projet) sur ce poste — pour retrouver "qu'est-ce que je faisais hier" sans archéologie manuelle
allowed-tools: [Bash]
---

# /synapse-recent-sessions

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/recentSessionsCli.js" [limite]
```

Lecture seule, aucune écriture. Lit directement `~/.claude/projects/` sur ce poste — ne touche
jamais au hub. `limite` est optionnel (défaut 10).

Ce n'est **pas** une indexation sémantique du contenu des sessions — juste un répertoire
dates/projets/titres, pour répondre à "est-ce que c'est encore là, sur quel poste" sans avoir à
grepper les transcripts à la main.
