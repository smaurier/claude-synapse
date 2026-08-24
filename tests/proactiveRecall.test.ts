import { describe, it, expect } from "vitest";
import { shouldSkip, filterAndFormatResults } from "../src/commands/proactiveRecall.js";
import type { HybridResult } from "../src/rag/hybridSearch.js";

// runProactiveRecall requires a real hub on disk; only the two pure helpers
// are unit-tested here. The hub integration is covered by the /brain-search
// integration tests (hybridSearch.integration.test.ts).

describe("shouldSkip", () => {
  it("skips a prompt shorter than 5 words", () => {
    expect(shouldSkip("RGAA")).toBe(true);
    expect(shouldSkip("qu'est-ce que LEP")).toBe(true);
    expect(shouldSkip("quatre mots ici ok")).toBe(true);
  });

  it("does not skip a prompt with exactly 5 words", () => {
    expect(shouldSkip("cinq mots dans ce prompt")).toBe(false);
  });

  it("does not skip a longer question", () => {
    expect(shouldSkip("qu'est-ce que le LEP exactement dans mon contexte")).toBe(false);
  });

  it("skips an empty or whitespace-only prompt", () => {
    expect(shouldSkip("")).toBe(true);
    expect(shouldSkip("   ")).toBe(true);
  });
});

describe("filterAndFormatResults", () => {
  it("returns null when no results meet the threshold", () => {
    const results: HybridResult[] = [{ path: "a.md", score: 0.3, matchType: "semantic" }];
    expect(filterAndFormatResults(results)).toBeNull();
  });

  it("returns null for an empty result list", () => {
    expect(filterAndFormatResults([])).toBeNull();
  });

  it("always includes exact matches regardless of score", () => {
    const results: HybridResult[] = [{ path: "lep.md", score: 0, matchType: "exact" }];
    expect(filterAndFormatResults(results)).toContain("lep.md");
    expect(filterAndFormatResults(results)).toContain("(exact)");
  });

  it("includes semantic results at MIN_SCORE (0.45) but not below", () => {
    const at: HybridResult[] = [{ path: "a.md", score: 0.45, matchType: "semantic" }];
    const below: HybridResult[] = [{ path: "b.md", score: 0.44, matchType: "semantic" }];
    expect(filterAndFormatResults(at)).toContain("a.md");
    expect(filterAndFormatResults(below)).toBeNull();
  });

  it("caps output at MAX_RESULTS (5) entries", () => {
    const results: HybridResult[] = Array.from({ length: 8 }, (_, i) => ({
      path: `file${i}.md`,
      score: 0.9,
      matchType: "semantic" as const,
    }));
    const out = filterAndFormatResults(results);
    expect(out?.split("\n").filter((l) => l.startsWith("- ")).length).toBe(5);
  });

  it("formats the header and entries correctly", () => {
    const results: HybridResult[] = [
      { path: "a.md", score: 1, matchType: "exact" },
      { path: "b.md", score: 0.734, matchType: "semantic" },
    ];
    const out = filterAndFormatResults(results);
    expect(out).toMatch(/^## Synapse — relevant memories\n\n/);
    expect(out).toContain("- a.md (exact)");
    expect(out).toContain("- b.md (0.734)");
  });
});
