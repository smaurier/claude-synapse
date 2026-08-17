import { describe, it, expect } from "vitest";
import { findExactMatches, applySupersession, type HybridResult } from "../src/rag/hybridSearch.js";

describe("findExactMatches", () => {
  it("finds a file containing the exact (case-insensitive) query substring", () => {
    const corpus = [
      { path: "a.md", content: "Le LEP (10k€) est intouchable, dernier recours." },
      { path: "b.md", content: "Sans rapport." },
    ];
    expect(findExactMatches(corpus, "lep")).toEqual(["a.md"]);
  });

  it("returns nothing for a multi-word natural question that appears nowhere literally", () => {
    const corpus = [{ path: "a.md", content: "Le LEP est intouchable, dernier recours." }];
    expect(findExactMatches(corpus, "quelle est la contrainte sur le LEP")).toEqual([]);
  });

  it("returns an empty array for an empty or whitespace-only query", () => {
    const corpus = [{ path: "a.md", content: "peu importe" }];
    expect(findExactMatches(corpus, "   ")).toEqual([]);
  });

  it("can match multiple files", () => {
    const corpus = [
      { path: "a.md", content: "mentionne RGAA une fois" },
      { path: "b.md", content: "RGAA apparaît ici aussi" },
      { path: "c.md", content: "rien à voir" },
    ];
    expect(findExactMatches(corpus, "RGAA").sort()).toEqual(["a.md", "b.md"]);
  });

  // Real false positives found testing against the actual hub (14/08): a
  // plain substring check matched "LEP" inside "FilePath" and
  // "compileProgressStore" — neither is about the LEP savings account.
  it("does not match a query hidden inside an unrelated longer word (PowerShell path)", () => {
    const corpus = [{ path: "a.md", content: 'Start-Process -FilePath "C:\\tools\\python.exe"' }];
    expect(findExactMatches(corpus, "lep")).toEqual([]);
  });

  it("does not match a query hidden inside an unrelated code identifier", () => {
    const corpus = [{ path: "a.md", content: "compileProgressStore (zustand)" }];
    expect(findExactMatches(corpus, "lep")).toEqual([]);
  });

  it("still matches the query as a standalone word surrounded by punctuation/parentheses", () => {
    const corpus = [{ path: "a.md", content: "Contrainte : LEP (10k€) intouchable, dernier recours." }];
    expect(findExactMatches(corpus, "LEP")).toEqual(["a.md"]);
  });

  it("matches at the very start or end of the file content, not just mid-text", () => {
    expect(findExactMatches([{ path: "a.md", content: "LEP en tête de fichier" }], "LEP")).toEqual(["a.md"]);
    expect(findExactMatches([{ path: "b.md", content: "en fin de fichier LEP" }], "LEP")).toEqual(["b.md"]);
  });
});

// Backlog 16/08 (étude de marché Synapse, idée agentic-stack "superseded_by")
// — refined after review: this must never HIDE a superseded memory (a closed
// project stays a valid documentary base per his own "on ne supprime plus"
// convention), only make clear, in search results, which of two conflicting
// versions is current. So: de-rank + annotate, never filter out.
describe("applySupersession", () => {
  const OLD = "---\nname: old\ndescription: x\nmetadata:\n  type: reference\n  superseded_by: new.md\n---\n\nancien contenu";
  const NEW = "---\nname: new\ndescription: x\nmetadata:\n  type: reference\n---\n\nnouveau contenu";
  const PLAIN = "---\nname: a\ndescription: x\nmetadata:\n  type: reference\n---\n\ncontenu";

  it("moves a superseded file after the version that replaces it, and annotates it — without removing either from the results", () => {
    const corpus = [
      { path: "old.md", content: OLD },
      { path: "new.md", content: NEW },
    ];
    const results: HybridResult[] = [
      { path: "old.md", score: 1, matchType: "exact" },
      { path: "new.md", score: 0.9, matchType: "semantic" },
    ];

    const applied = applySupersession(results, corpus);

    expect(applied.map((r) => r.path)).toEqual(["new.md", "old.md"]);
    expect(applied.find((r) => r.path === "old.md")?.supersededBy).toBe("new.md");
    expect(applied.find((r) => r.path === "new.md")?.supersededBy).toBeUndefined();
  });

  it("leaves results untouched when nothing is superseded", () => {
    const corpus = [{ path: "a.md", content: PLAIN }];
    const results: HybridResult[] = [{ path: "a.md", score: 1, matchType: "exact" }];
    expect(applySupersession(results, corpus)).toEqual(results);
  });

  it("still annotates a superseded result even when its replacement isn't among the results to reorder against", () => {
    const corpus = [
      { path: "old.md", content: OLD },
      { path: "new.md", content: NEW },
    ];
    const results: HybridResult[] = [{ path: "old.md", score: 1, matchType: "exact" }];

    const applied = applySupersession(results, corpus);

    expect(applied).toHaveLength(1);
    expect(applied[0]?.supersededBy).toBe("new.md");
  });

  it("ignores a superseded_by reference that points nowhere in the corpus (dangling — brain-lint's job to flag it, not search's)", () => {
    const corpus = [
      { path: "old.md", content: "---\nname: old\ndescription: x\nmetadata:\n  type: reference\n  superseded_by: fantome.md\n---\n\nx" },
    ];
    const results: HybridResult[] = [{ path: "old.md", score: 1, matchType: "exact" }];

    const applied = applySupersession(results, corpus);

    expect(applied[0]?.supersededBy).toBeUndefined();
  });
});
