import { describe, it, expect } from "vitest";
import { formatSearchResult } from "../src/commands/brainSearch.js";
import type { HybridResult } from "../src/rag/hybridSearch.js";

// Found 16/08 by manual testing on a disposable hub, not by guessing:
// applySupersession() computes `supersededBy` correctly (de-ranks the
// outdated file), but the CLI printed it with the exact same label as the
// version that replaces it — a reader would have no way to tell which of
// the two is current. This is what actually surfaces that field.
describe("formatSearchResult", () => {
  it("labels an exact match plainly when nothing supersedes it", () => {
    const r: HybridResult = { path: "a.md", score: 1, matchType: "exact" };
    expect(formatSearchResult(r)).toBe("correspondance exacte  a.md");
  });

  it("labels a semantic match with its score when nothing supersedes it", () => {
    const r: HybridResult = { path: "a.md", score: 0.734, matchType: "semantic" };
    expect(formatSearchResult(r)).toBe("0.734  a.md");
  });

  it("flags a superseded exact match with what replaces it", () => {
    const r: HybridResult = { path: "old.md", score: 1, matchType: "exact", supersededBy: "new.md" };
    expect(formatSearchResult(r)).toBe("correspondance exacte  old.md  [remplacé par : new.md]");
  });

  it("flags a superseded semantic match with what replaces it", () => {
    const r: HybridResult = { path: "old.md", score: 0.5, matchType: "semantic", supersededBy: "new.md" };
    expect(formatSearchResult(r)).toBe("0.500  old.md  [remplacé par : new.md]");
  });
});
