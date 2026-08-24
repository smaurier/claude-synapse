/**
 * The actual process entrypoint invoked by skills/synapse-init/SKILL.md:
 *   node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseInitCli.js" \
 *     "${CLAUDE_PLUGIN_DATA}" <hubUrl> <linkPath> [hubClonePath] [corpusRoot]
 *
 * The two trailing args are optional and only needed for the "adopt an
 * existing directory as hub" path (added 24/08): pass the existing clone's
 * own path as hubClonePath (same value as linkPath, typically) so
 * cloneOrPullHub pulls instead of cloning and ensureHubLink treats it as
 * self-hosting (see jonction.ts / synapseInit.ts doc comments) — and
 * corpusRoot when the hub root also holds non-memory material (docs,
 * scripts) that indexing shouldn't see.
 *
 * Deliberately thin, same rationale as the other *Cli.ts entrypoints.
 */
export {};
