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
import { type SharedConfig } from "./config.js";
export interface BootstrapOptions {
    hubUrl: string;
    localConfigPath: string;
    hubClonePath: string;
    linkPath: string;
    machineId: string;
    /** Set only when the caller explicitly wants to (re)configure where the
     *  RAG corpus lives within the hub (the "adopt an existing directory"
     *  path, added 24/08) — e.g. "memory" when the hub root also holds
     *  non-memory material. Omitted: an existing hub's corpusRoot is left
     *  exactly as read, so a second machine re-running /synapse-init plain
     *  can never silently reset what a previous machine configured. */
    corpusRoot?: string;
    cloneOrPullHub: (hubUrl: string, hubClonePath: string) => void | Promise<void>;
    createHubLink: (hubClonePath: string, linkPath: string) => void;
    verifyLink: (linkPath: string, hubClonePath: string) => boolean;
}
export interface BootstrapResult {
    sharedConfig: SharedConfig;
}
export declare function bootstrap(opts: BootstrapOptions): Promise<BootstrapResult>;
