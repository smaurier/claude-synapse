import { describe, it, expect } from "vitest";
import { isIdeasRefreshOverdue } from "../src/commands/refreshIndex.js";

// Même mécanisme que isAuditOverdue (refreshIndex-auditCadence.test.ts) : un deuxième
// déclencheur daemon-less, cadence distincte (bimensuelle, demandée par Sylvain le
// 01/11/2026 pour `reference_toutes_les_idees.md`, backlog item 54). Les deux partagent
// la même logique sous le capot (voir isCadenceOverdue dans refreshIndex.ts) — ce fichier
// ne re-teste donc pas chaque cas limite en détail, juste que le branchement spécifique
// aux idées se comporte comme l'audit.
describe("isIdeasRefreshOverdue", () => {
  it("is overdue when never refreshed (lastIdeasRefreshAt is null)", () => {
    expect(isIdeasRefreshOverdue(null, 15)).toBe(true);
  });

  it("is overdue when lastIdeasRefreshAt is unparseable", () => {
    expect(isIdeasRefreshOverdue("pas-une-date", 15)).toBe(true);
  });

  it("is not overdue when well within the cadence window", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(isIdeasRefreshOverdue(yesterday, 15)).toBe(false);
  });

  it("is overdue once the cadence window has passed", () => {
    const sixteenDaysAgo = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString();
    expect(isIdeasRefreshOverdue(sixteenDaysAgo, 15)).toBe(true);
  });
});
