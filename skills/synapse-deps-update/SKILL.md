---
description: Applique le sous-ensemble sûr des correctifs de dépendances (dev-only, non majeur) dans le dépôt de développement — jamais depuis un hook, jamais sur la production.
allowed-tools: [Bash]
---

# /synapse-deps-update

Complète `/synapse-doctor`, qui ne fait que détecter et rapporter (politique volontaire,
voir `dependencyAudit.ts`). Ceci est la seule commande qui **applique** — et seulement le
sous-ensemble que la politique approuvée qualifie déjà de sûr : dev-only, correctif non
majeur, jamais une dépendance de production. Rien de nouveau n'est décidé ici ; le
classement vient de `classifyVulnerability`, la même règle que `/synapse-doctor` utilise
pour son rapport.

**Uniquement dans le dépôt de développement de `claude-synapse`**, jamais ailleurs — la
commande elle-même refuse si `package.json.name` n'est pas `claude-synapse`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/depsUpdateCli.js" "${CLAUDE_PROJECT_DIR}"
```

## Après l'exécution

Si des paquets ont été installés (`package.json`/`package-lock.json` modifiés), **toujours**
enchaîner avec une vérification réelle avant de considérer que c'est fini — ne jamais se fier
au seul code de sortie de `npm install` :

```bash
npm run typecheck && npm run lint && npm test
```

Rapporter les trois résultats à l'utilisateur. Si l'un échoue, ne pas le corriger à l'aveugle :
montrer l'erreur et laisser l'utilisateur décider (rollback via `git checkout -- package.json
package-lock.json`, ou corriger le code si le correctif de dépendance a cassé quelque chose de
légitime à adapter — ça arrive, voir l'historique de ce dépôt pour vitest 2→5).

Si un paquet a échoué à l'installation (réseau, registre), le signaler sans relancer en
boucle — une seule tentative par invocation.
