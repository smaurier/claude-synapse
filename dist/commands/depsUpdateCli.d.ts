/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/depsUpdateCli.js" "${CLAUDE_PROJECT_DIR}"
 *
 * Contrairement à la quasi-totalité des autres *Cli.ts de ce dossier, ceci ne
 * prend JAMAIS `${CLAUDE_PLUGIN_DATA}`/`${CLAUDE_PLUGIN_ROOT}` comme cible —
 * cette commande agit sur le dépôt de DÉVELOPPEMENT (là où vivent
 * package.json, src/, les commits), jamais sur la copie installée et
 * jetable du plugin. `${CLAUDE_PROJECT_DIR}` est le bon candidat parce que
 * cette commande n'a de sens que lancée par Sylvain pendant qu'il travaille
 * sur ce dépôt — jamais depuis un hook, jamais depuis un hub quelconque.
 *
 * Garde avant toute action : `package.json.name` doit valoir
 * "claude-synapse". Sans ça, un appel depuis le mauvais répertoire de
 * travail écrirait dans le package.json d'un projet sans rapport — un
 * `--save-exact --save-dev` sur un dépôt qu'on ne voulait pas toucher.
 */
export {};
