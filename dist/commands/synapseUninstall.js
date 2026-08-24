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
import { existsSync, lstatSync, rmSync } from "node:fs";
import { defaultLocalConfigPath } from "../config/config.js";
import { removeLink } from "../jonction/jonction.js";
export async function runSynapseUninstall(opts) {
    let linkRemoved = false;
    try {
        if (lstatSync(opts.linkPath).isSymbolicLink()) {
            removeLink(opts.linkPath);
            linkRemoved = true;
        }
    }
    catch {
        // Nothing at linkPath at all — already uninstalled, safe no-op.
    }
    const localConfigPath = defaultLocalConfigPath(opts.pluginDataDir);
    const localConfigRemoved = existsSync(localConfigPath);
    if (localConfigRemoved)
        rmSync(localConfigPath);
    return { linkRemoved, localConfigRemoved };
}
//# sourceMappingURL=synapseUninstall.js.map