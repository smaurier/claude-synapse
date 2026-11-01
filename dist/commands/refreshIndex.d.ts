/**
 * The CLI-facing entrypoint for the SessionStart refresh hook — resolves
 * LocalConfig the same way brainSearch.ts does, then delegates to
 * refreshHubIndex(). Kept separate from brainSearch.ts because the hook
 * that calls this never needs search results, only the "index is current"
 * side effect (see rebuildIfStale's staleness check, problème 4/5).
 *
 * projectDir is optional (added 14/08, problème 6): when given, also
 * ensures the CURRENT project is linked to the hub — "zero action
 * utilisateur" per the multi-slug design, cheap enough to check every
 * session. Optional rather than required so this stays backward
 * compatible with callers that only care about the index refresh.
 *
 * Also implements problème 5's daemon-less periodic trigger: checks
 * SharedConfig.lastAuditAt against auditCadenceDays and runs
 * /synapse-doctor automatically when overdue — the mechanism was designed
 * (13/08) but nothing ever actually performed the audit or advanced the
 * timestamp until this. Only runs when projectDir is given (need it to
 * derive linkPath for the doctor run).
 *
 * Backlog item 54 (01/11/2026) reuses the same daemon-less shape for a second,
 * unrelated cadence: `reference_toutes_les_idees.md` going stale. The key
 * difference from the audit: /synapse-doctor is mechanical (lint rules, no
 * model call) and can therefore run and self-record its own timestamp right
 * here, inside a plain hook process. Refreshing the ideas synthesis means
 * reading across the corpus and judging what changed — that needs a model,
 * which this hook does not have access to (per /brain-audit's own rule: a
 * semantic judgment is never triggered blind from a hook). So this only ever
 * sets `ideasRefreshDue` on the result; nothing here reads memory files or
 * writes the synthesis. The SessionStart surface (refreshIndexCli.ts) turns
 * that into a one-line signal for whoever is in the session to act on — a
 * human, or the agent itself — and only the `/synapse-ideas-refresh` skill,
 * once it has actually done the work, calls markIdeasRefreshed() to advance
 * lastIdeasRefreshAt. Same split as audit/doctor, just across two different
 * places because the actual work can't happen in this process.
 *
 * Records this machine in the device registry (16/08, SharedConfig.
 * knownMachines) unconditionally — every SessionStart, not gated on
 * projectDir, since presence tracking doesn't need a project context.
 *
 * Backlog item 49 (16/10/2026) : `pluginRoot` est un troisième paramètre
 * OBLIGATOIRE, pas optionnel — un refactor qui oublierait de le passer à un
 * appel ferait taire le check de dépendances pour toujours, sans aucun
 * signal (voir le raisonnement complet sur runSynapseDoctor). `projectDir`
 * reste typé `string | undefined` plutôt que `?` pour permettre cet ordre :
 * TypeScript interdit un paramètre requis après un paramètre optionnel, donc
 * un appelant sans projectDir doit passer `undefined` explicitement, jamais
 * l'omettre.
 */
import { type SynapseDoctorReport } from "./synapseDoctor.js";
export interface RefreshIndexResult {
    auditTriggered: boolean;
    auditReport?: SynapseDoctorReport;
    /** True when the ideas-synthesis cadence (SharedConfig.ideasRefreshCadenceDays)
     *  has passed since lastIdeasRefreshAt — see the file-level comment above for
     *  why this never triggers work by itself, only the signal. */
    ideasRefreshDue: boolean;
}
/** Shared by every daemon-less periodic trigger in this file (audit, ideas
 *  refresh, and whatever comes next) — a bare "has this much time passed since
 *  that timestamp" check, with no knowledge of what it's gating. Null/unparseable
 *  "last done at" reads as overdue by definition: a thing never done, or whose
 *  record is corrupt, should catch up immediately rather than silently wait out
 *  a full cadence window first. */
export declare function isCadenceOverdue(lastDoneAt: string | null, cadenceDays: number): boolean;
export declare function isAuditOverdue(lastAuditAt: string | null, cadenceDays: number): boolean;
export declare function isIdeasRefreshOverdue(lastIdeasRefreshAt: string | null, cadenceDays: number): boolean;
export declare function runRefreshIndex(pluginDataDir: string, projectDir: string | undefined, pluginRoot: string): Promise<RefreshIndexResult>;
