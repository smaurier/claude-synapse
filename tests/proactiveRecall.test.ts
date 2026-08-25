import { describe, it, expect } from "vitest";
import {
  shouldSkip,
  filterAndFormatResults,
  hasStrictNegationMarker,
  hasBroadNegationMarker,
  formatContradictionWarnings,
  extractChunkText,
} from "../src/commands/proactiveRecall.js";
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
// Two tiers — see the module doc on proactiveRecall.ts for the full
// rationale (STRICT is safe at whole-file scope; BROAD needs chunk-scoping
// to avoid the 9-10/10 false-positive rate measured against a real hub).
describe("hasStrictNegationMarker", () => {
  it("detects the ⛔ convention marker", () => {
    expect(hasStrictNegationMarker("⛔ Ne pas postuler avant octobre.")).toBe(true);
  });

  it("detects 'interdit', even without ⛔", () => {
    expect(hasStrictNegationMarker("C'est strictement interdit de pousser ce code.")).toBe(true);
  });

  it("does NOT flag ordinary French negation on its own — calibrated against a real hub", () => {
    // 24/08: tried as the only tier first, fired on 9-10 of 10 real
    // candidate files in a real test — too common in ordinary prose to
    // carry any signal at whole-file scope. These phrasings are still
    // caught, but only via hasBroadNegationMarker scoped to one chunk.
    expect(hasStrictNegationMarker("Il ne faut pas relancer avant septembre.")).toBe(false);
    expect(hasStrictNegationMarker("Pas de scan d'offres avant le 23/10.")).toBe(false);
    expect(hasStrictNegationMarker("Jamais de suivi supplémentaire après la relance.")).toBe(false);
    expect(hasStrictNegationMarker("Attendre le retour de l'avocat avant d'agir.")).toBe(false);
  });

  it("does not flag ordinary text with no prohibition language at all", () => {
    expect(hasStrictNegationMarker("Le rendez-vous Alstom est prévu mardi à 14h.")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(hasStrictNegationMarker("STRICTEMENT INTERDIT avant la certif.")).toBe(true);
  });
});

describe("hasBroadNegationMarker", () => {
  it("catches the phrasings STRICT deliberately misses — only meant to be called on a scoped chunk, not a whole file", () => {
    expect(hasBroadNegationMarker("Il ne faut pas relancer avant septembre.")).toBe(true);
    expect(hasBroadNegationMarker("Pas de scan d'offres avant le 23/10.")).toBe(true);
    expect(hasBroadNegationMarker("Jamais de suivi supplémentaire après la relance.")).toBe(true);
    expect(hasBroadNegationMarker("Attendre le retour de l'avocat avant d'agir.")).toBe(true);
  });

  it("does not flag ordinary text with no negation language at all", () => {
    expect(hasBroadNegationMarker("Le rendez-vous Alstom est prévu mardi à 14h.")).toBe(false);
  });
});

describe("extractChunkText", () => {
  it("returns the whole content when chunkId is undefined (exact matches, short files)", () => {
    expect(extractChunkText("a.md", "contenu court", undefined)).toBe("contenu court");
  });

  it("returns just the matching chunk's text for a long, multi-chunk file", () => {
    const content = "a".repeat(300) + "z".repeat(300); // >500 chars, chunked
    const wholeFileText = extractChunkText("big.md", content, undefined);
    const laterChunkText = extractChunkText("big.md", content, "big.md#1");
    expect(laterChunkText.length).toBeLessThan(wholeFileText.length);
    expect(laterChunkText).toContain("z");
  });

  it("falls back to the whole content if the chunkId doesn't match any real chunk (defensive)", () => {
    expect(extractChunkText("a.md", "contenu", "a.md#99")).toBe("contenu");
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

  it("a BROAD-only marker elsewhere in a long file (outside the matching chunk) does NOT leak in — the concrete fix for the 9-10/10 false-positive rate found 24/08", () => {
    // "jamais" is BROAD-tier only (not STRICT), so this specifically
    // exercises chunk-scoping — a STRICT marker (⛔/interdit) would flag
    // regardless of chunk, by design (see module doc).
    const relevantChunk = "z".repeat(300); // no marker here — this is what actually matched the query
    const content = "jamais faire ça".padEnd(300, "a") + relevantChunk; // marker sits in chunk #0, query matched chunk #1
    const results: HybridResult[] = [{ path: "big.md", score: 0.9, matchType: "semantic", chunkId: "big.md#1" }];
    const corpus = new Map([["big.md", content]]);
    expect(formatContradictionWarnings(results, corpus)).toBeNull();
  });

  it("still flags a BROAD marker when it IS inside the actually-matching chunk", () => {
    // chunkFile: 500-char windows, 440-char stride — chunk #0 covers [0,500),
    // chunk #1 covers [440, ...). Starting the marker at char 520 keeps it
    // out of chunk #0 entirely while landing inside chunk #1.
    const content = "a".repeat(519) + " jamais faire ça".padEnd(201, "z"); // leading space: real word boundary before "jamais"
    const results: HybridResult[] = [{ path: "big.md", score: 0.9, matchType: "semantic", chunkId: "big.md#1" }];
    const corpus = new Map([["big.md", content]]);
    expect(formatContradictionWarnings(results, corpus)).toContain("big.md");
  });

  it("a STRICT marker (⛔/interdit) flags regardless of which chunk matched — whole-file safety net, deliberately not chunk-scoped", () => {
    const content = "⛔ interdit ceci".padEnd(300, "a") + "z".repeat(300);
    const results: HybridResult[] = [{ path: "big.md", score: 0.9, matchType: "semantic", chunkId: "big.md#1" }];
    const corpus = new Map([["big.md", content]]);
    expect(formatContradictionWarnings(results, corpus)).toContain("big.md");
  });
});
