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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
}

export const DEFAULT_SHARED_CONFIG: SharedConfig = {
  version: 1,
  refreshProjectsExclusions: [],
  ragEmbeddingModelVersion: "unset",
  lockTimeoutMinutes: 10,
  auditCadenceDays: 14,
  lastAuditAt: null,
  wipLimit: 5,
  marketWatchExtraSources: [],
};

function sharedConfigPath(hubDir: string): string {
  return join(hubDir, ".synapse", "config.json");
}

/** Missing file -> defaults (first machine ever). Existing file -> defaults merged
 *  under its contents, so a config written by an older plugin version that's
 *  missing a newer field still reads cleanly instead of crashing. */
export function readSharedConfig(hubDir: string): SharedConfig {
  const path = sharedConfigPath(hubDir);
  if (!existsSync(path)) {
    return { ...DEFAULT_SHARED_CONFIG };
  }
  const onDisk = JSON.parse(readFileSync(path, "utf8")) as Partial<SharedConfig>;
  return { ...DEFAULT_SHARED_CONFIG, ...onDisk };
}

export function writeSharedConfig(hubDir: string, config: SharedConfig): void {
  const path = sharedConfigPath(hubDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export interface LocalConfig {
  hubUrl: string;
  hubClonePath: string;
  machineId: string;
}

export function readLocalConfig(path: string): LocalConfig {
  if (!existsSync(path)) {
    throw new Error(
      `synapse: aucune config locale trouvée à "${path}". Lancer /synapse-init d'abord.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as LocalConfig;
}

export function writeLocalConfig(path: string, config: LocalConfig): void {
  if (!config.hubUrl || config.hubUrl.trim() === "") {
    throw new Error("synapse: hubUrl est requis pour la config locale (impossible de cloner sans URL).");
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
}

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
export function defaultLocalConfigPath(pluginDataDir: string): string {
  return join(pluginDataDir, "local-config.json");
}

export function defaultHubClonePath(pluginDataDir: string): string {
  return join(pluginDataDir, "hub");
}
