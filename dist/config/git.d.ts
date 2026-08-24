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
export declare function cloneOrPullHub(hubUrl: string, hubClonePath: string): Promise<void>;
