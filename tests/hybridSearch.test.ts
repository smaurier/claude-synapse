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
});
