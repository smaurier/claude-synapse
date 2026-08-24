/**
 * Turns a hub directory into the CorpusFile[] shape search.ts expects — the
 * missing piece between LocalConfig.hubClonePath (problème 2) and the RAG
 * pipeline (problème 4), needed before any real CLI entrypoint can exist.
 *
 * Recursively walks .md files, skipping directories that never hold memory
 * content: .git (repo internals), node_modules (shouldn't exist in a memory
 * hub, but defensive), .synapse (this plugin's own derived index/config —
 * indexing it would mean re-embedding our own housekeeping files instead of
 * the user's actual memory).
 *
 * Deliberately NOT wired to SharedConfig.refreshProjectsExclusions: that
 * field's format is still an open backlog item for a different concern
 * (which project slugs the multi-slug refresh scans, problème 6) — borrowing
 * an undefined contract for a purpose it wasn't scoped for would just move
 * the ambiguity here instead of resolving it.
 *
 * Paths are returned relative to rootDir, with forward slashes on every
 * platform: they become chunk ids and are shown to the user in search
 * results, so they need to stay stable and readable regardless of which
 * machine built the index — not tied to an absolute, machine-specific clone
 * location.
 */
import type { CorpusFile } from "./hash.js";
export declare function loadCorpus(rootDir: string): CorpusFile[];
/**
 * The corpusRoot-aware entrypoint: what searchHub/hybridSearchHub/
 * refreshHubIndex actually call. loadCorpus() itself stays a plain
 * "walk this directory" primitive (still used directly by tests and
 * anywhere the caller already knows the exact directory to scan) — this
 * is the one place that also asks "which directory, for THIS hub" via
 * SharedConfig.corpusRoot (added 24/08, "adopt an existing directory as
 * hub" — see resolveCorpusRoot's own doc comment).
 */
export declare function loadHubCorpus(hubClonePath: string): CorpusFile[];
