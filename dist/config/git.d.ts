/**
 * Real git clone/pull for the hub — what bootstrap.ts's injected
 * cloneOrPullHub is wired to at the real CLI entrypoint. Shells out to the
 * system git binary (no git library dependency, one less thing to keep
 * light per the project's general bias against heavy native deps).
 *
 * Pull uses --ff-only deliberately: never merge/rebase automatically on
 * divergence. A silent auto-merge of the memory hub would be exactly the
 * kind of "more than one exemplar reconciled behind your back" situation
 * the whole jonction thesis ("zero merge by construction") exists to
 * avoid — surfacing a hard failure here is consistent with that, not an
 * unrelated caution.
 */
/** Thin, reusable git runner — exported for other modules (syncBrain.ts)
 *  that need more git subcommands than clone/pull. Returns stdout. */
export declare function runGit(args: string[], cwd: string): Promise<string>;
/** git-crypt is entirely optional and unrelated to Synapse itself — most
 *  hubs won't use it. Gated on `.git-crypt/` existing so the common
 *  (non-encrypted) case never even shells out to a binary that may not be
 *  installed. When it IS present, a failed unlock (no key added as
 *  collaborator yet on this machine, git-crypt missing, ...) must not block
 *  the clone/pull that already succeeded — it just leaves the working tree
 *  exactly as encrypted/plaintext as it already was, same as before this
 *  function existed. Exported for direct testing. */
export declare function unlockGitCryptIfPresent(hubClonePath: string): Promise<void>;
export declare function cloneOrPullHub(hubUrl: string, hubClonePath: string): Promise<void>;
