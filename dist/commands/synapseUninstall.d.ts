/**
 * /synapse-uninstall (problème 7) — deliberately minimal, matching
 * /synapse-init's current one-project-at-a-time scope (multi-slug tracking,
 * problème 6, isn't built yet, so there's no registry of "every linked
 * project" to walk). Quasi non-destructive by construction: removes the
 * link (never the hub content behind it — removeLink() refuses to touch
 * anything that isn't actually a link) and this machine's LocalConfig. The
 * hub clone itself is left alone on purpose — it's a real git repo the
 * user may still want, not disposable plugin state.
 */
export interface SynapseUninstallOptions {
    pluginDataDir: string;
    linkPath: string;
}
export interface SynapseUninstallResult {
    linkRemoved: boolean;
    localConfigRemoved: boolean;
}
export declare function runSynapseUninstall(opts: SynapseUninstallOptions): Promise<SynapseUninstallResult>;
