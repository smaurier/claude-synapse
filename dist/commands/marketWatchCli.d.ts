/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/marketWatchCli.js" "${CLAUDE_PLUGIN_DATA}"
 *
 * Revu le 14/08 : prend désormais pluginDataDir, contrairement au design
 * initial ("ne touche pas le hub, lectures GitHub publiques pures") — pour
 * lire SharedConfig.marketWatchExtraSources (sources ajoutées par
 * l'utilisateur, cf config.ts). pluginDataDir reste optionnel : sans lien
 * hub configuré, le rapport se limite à KNOWN_COMPETITORS plutôt que
 * d'échouer — cette commande reste utilisable avant tout /synapse-init.
 */
export {};
