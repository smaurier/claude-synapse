/**
 * The CLI-facing entrypoint for a manual multi-root refresh-projects scan —
 * the piece that was missing entirely: refreshProjects() (the scanner)
 * existed and was tested since problème 6's implementation, but nothing
 * ever actually called it with real config/exclusions. ensureCurrentProjectLinked
 * (wired into SessionStart) only ever covers ONE project at a time.
 *
 * Exclusion format decided 14/08: exact top-level directory names under
 * rootDir — matches refreshProjects()'s own scan granularity (readdirSync,
 * not recursive), so no glob-matching library is needed for this.
 *
 * Persists rootDir into SharedConfig.refreshProjectsRoots (16/08, problème 6
 * follow-up): a project tree scanned manually once this way gets picked up
 * automatically by every later periodic audit (synapseDoctor.ts) too — the
 * complementary case to ensureCurrentProjectLinked, which only ever covers
 * a project the user has actually opened a session in. Locked like any
 * other shared-config write (bootstrap.ts, setSynapseConfig).
 */
import { type RefreshProjectsResult } from "./refreshProjects.js";
export declare function runRefreshProjects(pluginDataDir: string, rootDir: string): Promise<RefreshProjectsResult[]>;
