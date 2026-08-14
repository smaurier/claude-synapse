/**
 * Orchestrates the first-run sequence, decided 13/08 after Claude's own
 * self-review surfaced the ordering gap: you need the local config (hub URL)
 * before you can clone anything, and you need the hub cloned before you can
 * read its shared config.
 *
 * Git and link operations are injected rather than called directly so this
 * sequence — the part that actually matters, the ORDER and the failure
 * handling — is unit-testable without a real network or real filesystem
 * links. The jonction module (problème 1) is what createHubLink/verifyLink
 * are expected to be wired to in the real CLI entrypoint.
 *
 * The whole-repo lock (problème 3) is called directly, not injected: unlike
 * git/jonction it's cheap, deterministic, local fs — nothing worth faking
 * in a unit test. Added 14/08 after re-reading the design doc mid-review:
 * "le verrou couvre aussi la config partagée" applies exactly to the
 * readSharedConfig/writeSharedConfig step below, which was unlocked until
 * now. Uses DEFAULT_SHARED_CONFIG.lockTimeoutMinutes rather than the hub's
 * own configured timeout — reading that value would itself need the lock
 * this call is meant to acquire.
 */

import { writeLocalConfig } from "./config.js";
import { readSharedConfig, writeSharedConfig, DEFAULT_SHARED_CONFIG, type SharedConfig } from "./config.js";
import { acquireLock, releaseLock } from "../lock/lock.js";

export interface BootstrapOptions {
  hubUrl: string;
  localConfigPath: string;
  hubClonePath: string;
  linkPath: string;
  machineId: string;
  cloneOrPullHub: (hubUrl: string, hubClonePath: string) => void | Promise<void>;
  createHubLink: (hubClonePath: string, linkPath: string) => void;
  verifyLink: (linkPath: string, hubClonePath: string) => boolean;
}

export interface BootstrapResult {
  sharedConfig: SharedConfig;
}

export async function bootstrap(opts: BootstrapOptions): Promise<BootstrapResult> {
  // 1. Local config first — nothing else is possible without knowing where the hub is.
  writeLocalConfig(opts.localConfigPath, {
    hubUrl: opts.hubUrl,
    hubClonePath: opts.hubClonePath,
    machineId: opts.machineId,
  });

  // 2. Clone (first machine ever) or pull (joining an existing hub).
  await opts.cloneOrPullHub(opts.hubUrl, opts.hubClonePath);

  // 3. Read + persist shared config — locked, because this is a write to
  //    hub-shared state another machine could be touching concurrently
  //    (e.g. two machines bootstrapping onto the same fresh hub at once).
  //    readSharedConfig() already returns defaults when absent, but we
  //    persist those defaults now (first machine ever) rather than leaving
  //    the hub without a config file until the next write.
  const lockResult = acquireLock(opts.hubClonePath, opts.machineId, DEFAULT_SHARED_CONFIG.lockTimeoutMinutes);
  if (!lockResult.acquired) {
    throw new Error(
      `synapse: verrou du hub déjà détenu par "${lockResult.heldBy}" depuis ${lockResult.since} — ` +
        `une autre machine est peut-être en train d'initialiser ou de modifier ce hub. Réessayer dans un instant.`,
    );
  }
  let sharedConfig: SharedConfig;
  try {
    sharedConfig = readSharedConfig(opts.hubClonePath);
    writeSharedConfig(opts.hubClonePath, sharedConfig);
  } finally {
    releaseLock(opts.hubClonePath, opts.machineId);
  }

  // 4. Create the link.
  opts.createHubLink(opts.hubClonePath, opts.linkPath);

  // 5. Verify — never report success without proof the link actually works.
  const verified = opts.verifyLink(opts.linkPath, opts.hubClonePath);
  if (!verified) {
    throw new Error(
      `synapse: vérification post-install échouée pour "${opts.linkPath}" — le lien a été créé ` +
        `mais une écriture réelle à travers n'est pas visible côté hub. Ne pas considérer l'install réussie.`,
    );
  }

  return { sharedConfig };
}
