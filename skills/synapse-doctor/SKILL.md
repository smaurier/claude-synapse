---
description: Audit périodique complet (lien, index, brain-lint) — rapport, un seul auto-fix sûr (lien cassé)
disable-model-invocation: true
allowed-tools: [Bash]
---

# /synapse-doctor

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseDoctorCli.js" "${CLAUDE_PLUGIN_DATA}" <linkPath>
```

Rapport-only, sauf un cas déjà tranché sûr : un lien **cassé** est recréé automatiquement (le
signaler dans le compte-rendu, pas le cacher). Un lien vers la **mauvaise cible** n'est jamais
touché automatiquement — pourrait signifier une reconfiguration volontaire, à confirmer avec
l'utilisateur, jamais écrasé en silence.

Enregistre la date de cet audit dans la config partagée — c'est ce qui alimente la cadence
périodique (`/synapse-doctor` déclenché automatiquement quand le délai configuré est dépassé,
vérifié à chaque `SessionStart`).
