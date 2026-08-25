import { describe, it, expect } from "vitest";
import { shouldSkip, filterAndFormatResults, hasNegationMarker, formatContradictionWarnings } from "../src/commands/proactiveRecall.js";
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

// Backlog #28 (24/08) — the 10/08 incident wasn't a retrieval failure (the
// contradicting memory WAS already surfaced that day), it was an attention
// failure: the fragment that contradicted the thesis got read and
// deprioritized. So this doesn't gate on score or on an already-tagged ⛔ —
// it flags any candidate result whose *content* carries a negation/
// prohibition marker, so it renders distinctly from ordinary recalled
// context instead of blending into a list that's easy to skim past.
describe("hasNegationMarker", () => {
  it("detects the ⛔ convention marker", () => {
    expect(hasNegationMarker("⛔ Ne pas postuler avant octobre.")).toBe(true);
  });

  it("detects 'interdit', even without ⛔", () => {
    expect(hasNegationMarker("C'est strictement interdit de pousser ce code.")).toBe(true);
  });

  it("does NOT flag ordinary French negation on its own — calibrated against a real hub", () => {
    // 24/08: a broader marker list ("ne pas", "pas de", "jamais", "attendre")
    // was tried first and fired on 9-10 of 10 real candidate files in a real
    // test — those constructions are too common in ordinary prose to carry
    // any signal at file granularity. Narrowed to what actually
    // discriminated on that same data. See the module doc for the chunk-
    // level follow-up that would let the broader list work safely.
    expect(hasNegationMarker("Il ne faut pas relancer avant septembre.")).toBe(false);
    expect(hasNegationMarker("Pas de scan d'offres avant le 23/10.")).toBe(false);
    expect(hasNegationMarker("Jamais de suivi supplémentaire après la relance.")).toBe(false);
    expect(hasNegationMarker("Attendre le retour de l'avocat avant d'agir.")).toBe(false);
  });

  it("does not flag ordinary text with no prohibition language at all", () => {
    expect(hasNegationMarker("Le rendez-vous Alstom est prévu mardi à 14h.")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(hasNegationMarker("STRICTEMENT INTERDIT avant la certif.")).toBe(true);
  });

  it("returns false for content with no negation language at all", () => {
    expect(hasNegationMarker("Le rendez-vous est prévu mardi à 14h.")).toBe(false);
  });
});

describe("formatContradictionWarnings", () => {
  it("returns null when no result's content carries a negation marker", () => {
    const results: HybridResult[] = [{ path: "a.md", score: 0.9, matchType: "semantic" }];
    const corpus = new Map([["a.md", "Contenu neutre, rien à signaler."]]);
    expect(formatContradictionWarnings(results, corpus)).toBeNull();
  });

  it("flags a result whose content contains a negation marker, even at low score", () => {
    // Deliberately below proactiveRecall's own MIN_SCORE (0.45) — a real
    // constraint shouldn't be missed just because it scored weakly on this
    // particular phrasing of the prompt.
    const results: HybridResult[] = [{ path: "career.md", score: 0.2, matchType: "semantic" }];
    const corpus = new Map([["career.md", "⛔ Ne pas scanner d'offres avant le 23/10/2026."]]);
    const out = formatContradictionWarnings(results, corpus);
    expect(out).toContain("career.md");
  });

  it("ignores a result whose path isn't in the corpus map (defensive, shouldn't normally happen)", () => {
    const results: HybridResult[] = [{ path: "missing.md", score: 0.9, matchType: "semantic" }];
    expect(formatContradictionWarnings(results, new Map())).toBeNull();
  });

  it("renders with a header distinct from the ordinary recall section", () => {
    const results: HybridResult[] = [{ path: "a.md", score: 0.9, matchType: "semantic" }];
    const corpus = new Map([["a.md", "⛔ jamais avant validation"]]);
    const out = formatContradictionWarnings(results, corpus);
    expect(out).toMatch(/^## ⚠️/);
    expect(out).not.toMatch(/^## Synapse — relevant memories/);
  });

  it("only flags results actually passed in, not every negation-bearing file in the corpus", () => {
    const results: HybridResult[] = [{ path: "a.md", score: 0.9, matchType: "semantic" }];
    const corpus = new Map([
      ["a.md", "rien de particulier"],
      ["b.md", "⛔ jamais faire ça"], // in corpus, but NOT in results — must not leak in
    ]);
    const out = formatContradictionWarnings(results, corpus);
    expect(out).toBeNull();
  });
});
