import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSessionResults, readSessionResults, formatSessionResultsAsContext } from "../src/commands/sessionResults.js";
import type { HybridResult } from "../src/rag/hybridSearch.js";

// Backlog 16/08 (étude de marché Synapse) — compaction-light: Synapse ne
// journalise pas la session (ce n'est pas un observateur), donc rien à
// condenser à la PreCompact — la version qui a du sens ici est plus
// modeste : réinjecter après coup (hook PostCompact, vérifié auprès du
// guide Claude Code puis recoupé sur 27 fichiers réels du corpus étudié
// le 16/08 — "PreCompact" seul aurait été le mauvais hook) les résultats
// de recherche déjà remontés cette session, pas des observations qui
// n'existent pas.

let pluginDataDir: string;

beforeEach(() => {
  pluginDataDir = mkdtempSync(join(tmpdir(), "synapse-session-results-"));
});

afterEach(() => {
  rmSync(pluginDataDir, { recursive: true, force: true });
});

const RESULTS: HybridResult[] = [
  { path: "a.md", score: 1, matchType: "exact" },
  { path: "old.md", score: 0.7, matchType: "semantic", supersededBy: "new.md" },
];

describe("writeSessionResults / readSessionResults", () => {
  it("round-trips results for a given session id", () => {
    writeSessionResults(pluginDataDir, "session-abc", "format de date", RESULTS);
    const read = readSessionResults(pluginDataDir, "session-abc");
    expect(read).toMatchObject({ query: "format de date", results: RESULTS });
  });

  it("returns null for a session that never searched anything", () => {
    expect(readSessionResults(pluginDataDir, "never-searched")).toBeNull();
  });

  it("keeps different sessions' results separate", () => {
    writeSessionResults(pluginDataDir, "session-1", "requête 1", [RESULTS[0]!]);
    writeSessionResults(pluginDataDir, "session-2", "requête 2", [RESULTS[1]!]);

    expect(readSessionResults(pluginDataDir, "session-1")?.query).toBe("requête 1");
    expect(readSessionResults(pluginDataDir, "session-2")?.query).toBe("requête 2");
  });

  it("a later search for the same session overwrites the earlier one — only the most recent survives compaction, not a growing log", () => {
    writeSessionResults(pluginDataDir, "session-abc", "première requête", [RESULTS[0]!]);
    writeSessionResults(pluginDataDir, "session-abc", "deuxième requête", RESULTS);

    expect(readSessionResults(pluginDataDir, "session-abc")?.query).toBe("deuxième requête");
  });
});

describe("formatSessionResultsAsContext", () => {
  it("returns null when there is nothing to reinject", () => {
    expect(formatSessionResultsAsContext(null)).toBeNull();
  });

  it("renders the query and each result, flagging superseded ones", () => {
    const text = formatSessionResultsAsContext({ query: "format de date", results: RESULTS });
    expect(text).toContain("format de date");
    expect(text).toContain("a.md");
    expect(text).toContain("old.md");
    expect(text).toContain("new.md"); // the replacement, named
  });

  it("stays under a conservative size cap even with many results (exact platform cap unconfirmed — bounded defensively regardless)", () => {
    const many: HybridResult[] = Array.from({ length: 200 }, (_, i) => ({
      path: `fichier-tres-long-numero-${i}-avec-un-nom-verbeux.md`,
      score: 0.5,
      matchType: "semantic" as const,
    }));
    const text = formatSessionResultsAsContext({ query: "x", results: many });
    expect(text!.length).toBeLessThan(4000);
  });
});
