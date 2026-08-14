import { describe, it, expect } from "vitest";
import { findExactMatches } from "../src/rag/hybridSearch.js";

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
