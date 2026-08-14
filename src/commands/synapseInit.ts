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
 */

import { hostname } from "node:os";
import { bootstrap } from "../config/bootstrap.js";
import { defaultHubClonePath, defaultLocalConfigPath } from "../config/config.js";
import { cloneOrPullHub } from "../config/git.js";
import { ensureHubLink, verifyWriteThrough, type EnsureLinkResult } from "../jonction/jonction.js";

export interface SynapseInitOptions {
  pluginDataDir: string;
  hubUrl: string;
  linkPath: string;
  /** Override for tests / advanced setups; defaults to <pluginDataDir>/hub. */
  hubClonePath?: string;
}

export interface SynapseInitResult {
  hubClonePath: string;
  link: EnsureLinkResult;
}

export async function runSynapseInit(opts: SynapseInitOptions): Promise<SynapseInitResult> {
  const hubClonePath = opts.hubClonePath ?? defaultHubClonePath(opts.pluginDataDir);
  let link: EnsureLinkResult | undefined;

  await bootstrap({
    hubUrl: opts.hubUrl,
    localConfigPath: defaultLocalConfigPath(opts.pluginDataDir),
    hubClonePath,
    linkPath: opts.linkPath,
    machineId: hostname(),
    cloneOrPullHub,
    createHubLink: (hub, linkPath) => {
      link = ensureHubLink(hub, linkPath);
    },
    verifyLink: verifyWriteThrough,
  });

  // bootstrap() only reaches this point after createHubLink ran without
  // throwing, so `link` is always set — the `!` documents that invariant
  // rather than working around a real possibility of it being undefined.
  return { hubClonePath, link: link! };
}
