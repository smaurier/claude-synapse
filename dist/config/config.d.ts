/**
 * Two-layer config, per design decision (problème 2, 13/08):
 *
 *  - SharedConfig lives INSIDE the hub (.synapse/config.json), versioned and
 *    synced like everything else in the hub repo. It holds anything that
 *    must agree across machines to avoid drift — most notably the pinned
 *    RAG embedding model version, which is how the RAG divergence problem
 *    gets solved: both machines read the same file after every pull.
 *
 *  - LocalConfig lives OUTSIDE the hub, one file per machine, never synced.
 *    It only holds what genuinely cannot be shared: the hub URL itself
 *    (needed before anything can be cloned), the local clone path, and a
 *    machine identifier.
 */
export interface SharedConfig {
    version: 1;
    refreshProjectsExclusions: string[];
    ragEmbeddingModelVersion: string;
    lockTimeoutMinutes: number;
    auditCadenceDays: number;
    lastAuditAt: string | null;
    /** brain-lint's WIP limiter threshold — found 14/08 hardcoded at 5 with
     *  no way to adjust it: flagged as noise on a real hub with ~40 active
     *  projects, where 5 fires on nearly every run. Configurable per hub
     *  rather than guessing a "correct" generic default. */
    wipLimit: number;
    /** /synapse-market-watch's KNOWN_COMPETITORS is a hardcoded baseline in
     *  source (editing it means shipping a new plugin version) — this is the
     *  user-editable complement, "owner/repo" entries added on top of it.
     *  Shared (not per-machine local config) so every machine's watch stays
     *  in sync, same reasoning as refreshProjectsExclusions. */
    marketWatchExtraSources: string[];
    /** findMergeCandidates() is O(n²) pairwise chunk comparison — measured
     *  16/08 (scripts/scale-test.mjs, fast synthetic embed to isolate
     *  algorithmic cost from model latency): 255ms at 100 files, 7s at 500,
     *  27s at 1000, 117s at 2000 — quadratic, and 117s alone already exceeds
     *  most of the 120s SessionStart hook budget /synapse-doctor runs inside
     *  when the periodic audit is overdue. Above this many files, callers
     *  skip the comparison and report why instead of risking a hook timeout.
     *  Never validated against a real corpus this large — the default is a
     *  deliberately conservative margin below where the synthetic timing
     *  starts eating the hook budget, not a hard technical ceiling. */
    mergeCandidatesMaxFiles: number;
    /** machineId -> ISO timestamp of its last SessionStart on this hub. A
     *  device registry (found 16/08 competitive review: two higher-starred
     *  comparable projects have one, Synapse didn't) — "which machines are
     *  actually using this hub" is genuinely useful, not just a marketing
     *  checkbox. Updated on every SessionStart (recordMachineSeen below),
     *  unlocked on purpose: a soft presence signal, not correctness-critical
     *  — the rare lost update from a genuine concurrent-write race just means
     *  one machine's timestamp is a session behind, self-corrects next time. */
    knownMachines: Record<string, string>;
    /** Roots that runRefreshProjects() has been given at least once — persisted
     *  automatically (not user-edited by hand, though /synapse-config can) so
     *  a project tree scanned manually once gets re-scanned on every periodic
     *  audit (synapseDoctor.ts) afterwards, without retyping the root each
     *  time. Covers projects that existed before Synapse was ever set up —
     *  ensureCurrentProjectLinked already handles brand-new project sessions
     *  automatically, this is the complementary case. */
    refreshProjectsRoots: string[];
    /** Where the RAG corpus actually lives, relative to the hub root — added
     *  24/08 for the "adopt an existing directory as hub" path. Most hubs are
     *  created BY Synapse and contain nothing but memory, so "." (the hub
     *  root itself) is right by default. But adopting a pre-existing repo as
     *  hub means the real memory can be a subfolder of something that also
     *  holds unrelated material (docs, scripts, other tooling) that indexing
     *  should never see. Shared, not local: every machine must scan the same
     *  subset, or the corpus fingerprint two machines compute for the "did
     *  anything change" staleness check would drift between them. */
    corpusRoot: string;
}
export declare const DEFAULT_SHARED_CONFIG: SharedConfig;
/** Missing file -> defaults (first machine ever). Existing file -> defaults merged
 *  under its contents, so a config written by an older plugin version that's
 *  missing a newer field still reads cleanly instead of crashing. */
export declare function readSharedConfig(hubDir: string): SharedConfig;
/** The directory the RAG corpus loader should actually scan for this hub —
 *  the hub root itself unless SharedConfig.corpusRoot narrows it to a
 *  subdirectory. Centralized here (not left to each RAG call site) so
 *  searchHub/hybridSearchHub/refreshHubIndex can never disagree on it. */
export declare function resolveCorpusRoot(hubClonePath: string): string;
export declare function writeSharedConfig(hubDir: string, config: SharedConfig): void;
export interface LocalConfig {
    hubUrl: string;
    hubClonePath: string;
    machineId: string;
    /** Project name -> absolute local path, THIS machine only (backlog
     *  16/08/17/08, item 8: resolves `metadata.cites: <project>/<path>`
     *  memory references to a real git repo to check for drift). Belongs
     *  here, not SharedConfig — a local absolute path is inherently
     *  machine-specific (feedback_chemins_multipostes), the same reasoning
     *  that already keeps hubClonePath itself local-only. Optional: absent
     *  on every LocalConfig written before this field existed, and on any
     *  machine that never registered a project. */
    knownProjectRoots?: Record<string, string>;
}
export declare function readLocalConfig(path: string): LocalConfig;
export declare function writeLocalConfig(path: string, config: LocalConfig): void;
/**
 * Default on-disk locations, anchored to the plugin's per-machine data
 * directory (decided 14/08: ${CLAUDE_PLUGIN_DATA}, ~/.claude/plugins/data/synapse/
 * — documented, per-machine, survives plugin updates unlike
 * ${CLAUDE_PLUGIN_ROOT}). These take that directory as a plain parameter
 * rather than reading process.env.CLAUDE_PLUGIN_DATA themselves: env var
 * inheritance is confirmed for hook processes but NOT documented for a
 * Bash process launched from a skill — the real CLI entrypoint resolves it
 * once (via an explicit CLI argument substituted into the skill's command
 * text) and passes it down. Nothing in this module reaches for ambient
 * process state.
 */
export declare function defaultLocalConfigPath(pluginDataDir: string): string;
export declare function defaultHubClonePath(pluginDataDir: string): string;
/**
 * Records this machine's presence on the hub — the device registry (see
 * SharedConfig.knownMachines). Called on every SessionStart, unlocked on
 * purpose: this is a soft "who's using this hub" signal, not something a
 * lost update under a rare concurrent-write race would meaningfully break —
 * that machine's timestamp just lags one session behind, self-correcting
 * the next time it starts a session.
 */
export declare function recordMachineSeen(hubClonePath: string, machineId: string, now?: Date): void;
