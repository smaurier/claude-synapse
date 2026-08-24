/**
 * The CLI-facing entrypoint for /synapse-init — wires bootstrap.ts's
 * injected dependencies to the real implementations (git.ts, jonction.ts)
 * and derives machineId automatically (os.hostname()) rather than asking
 * the user, to keep first-run friction low.
 *
 * createHubLink is wired to ensureHubLink(), not createLink() directly:
 * bootstrap() calls it unconditionally on every run, so a bare createLink()
 * would throw on a second /synapse-init (the link already exists) even
 * when it's already correct — ensureHubLink() is what makes re-running
 * /synapse-init safe (problème 1's idempotence design, only actually wired
 * up here). The action it took (no-op / created / recreated / backed up)
 * is captured via closure so the caller can report it — bootstrap.ts's
 * createHubLink signature returns void, and widening that tested interface
 * just to carry this one extra bit wasn't worth it.
 *
 * Visibility check runs BEFORE anything else — refuses outright (never
 * even clones) if the hub is confirmed public. Security gap flagged in the
 * design since 13/08, closed 14/08. GitHub-only (see hubVisibility.ts); for
 * any other host the check can't run, so it surfaces a warning in the
 * result instead of silently proceeding as if verified.
 */
import { type EnsureLinkResult } from "../jonction/jonction.js";
export interface SynapseInitOptions {
    pluginDataDir: string;
    hubUrl: string;
    linkPath: string;
    /** Override for tests / advanced setups; defaults to <pluginDataDir>/hub.
     *  Also how "adopt an existing directory as hub" works: pass the existing
     *  clone's own path as BOTH hubClonePath and linkPath — cloneOrPullHub
     *  detects the existing .git and pulls instead of cloning, and
     *  ensureHubLink treats linking a location to itself as already
     *  satisfied (see jonction.ts). */
    hubClonePath?: string;
    /** See BootstrapOptions.corpusRoot — forwarded as-is. */
    corpusRoot?: string;
}
export interface SynapseInitResult {
    hubClonePath: string;
    link: EnsureLinkResult;
    visibilityWarning?: string;
}
export declare function runSynapseInit(opts: SynapseInitOptions): Promise<SynapseInitResult>;
