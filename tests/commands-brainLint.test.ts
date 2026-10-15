import { describe, it, expect, vi } from "vitest";
import { extractFrontmatter, lintFile, lintCorpus, findMergeCandidates, findMergeCandidatesGuarded, checkWipLimit, checkSupersessionReferences, slugStem } from "../src/commands/brainLint.js";
import { chunkFile } from "../src/rag/chunk.js";

const VALID_REFERENCE = `---
name: exemple
description: une ligne
metadata:
  type: reference
---

Contenu.
`;

const VALID_PROJECT = `---
name: exemple-projet
description: une ligne
metadata:
  type: project
  created: 2026-08-01
  expires: 2026-12-31
---

Contenu.
`;

// The index and its sub-indexes carry no frontmatter by convention: they
// are a table of contents, not a memory.
const INDEX_WITHOUT_FRONTMATTER = `# Memory Index

- [Profil general](user_profile.md) — accroche
`;

// A journal-shaped fiche (5 dated sections, above the threshold), with a
// head section placed either before or after them.
function journalWithHead(head: string, { atEnd = false } = {}): string {
  const sections = Array.from({ length: 5 }, (_, i) => `## S${i} — 14/0${i + 1}\ncontenu`).join("\n");
  const body = atEnd ? `${sections}\n${head}\nx` : `${head}\nx\n${sections}`;
  return `---\nname: x\ndescription: x\nmetadata:\n  type: reference\n---\n\n${body}`;
}

describe("extractFrontmatter", () => {
  it("parses top-level and nested fields", () => {
    const fm = extractFrontmatter(VALID_PROJECT);
    expect(fm?.fields.name).toBe("exemple-projet");
    expect(fm?.fields["metadata.type"]).toBe("project");
    expect(fm?.fields["metadata.expires"]).toBe("2026-12-31");
  });

  it("returns null when there's no frontmatter block", () => {
    expect(extractFrontmatter("juste du texte")).toBeNull();
  });

  it("parses frontmatter even when the file starts with a UTF-8 BOM", () => {
    // Real-world trigger: files saved by some Windows editors/tools carry a
    // leading BOM (EF BB BF / U+FEFF) before the first byte of content. The
    // frontmatter regex anchors on `^---`, so an unstripped BOM silently
    // makes the file invisible to every check that depends on this parser
    // (WIP count, expires warnings, type detection) — not just this one.
    const withBom = "﻿" + VALID_PROJECT;
    const fm = extractFrontmatter(withBom);
    expect(fm?.fields.name).toBe("exemple-projet");
    expect(fm?.fields["metadata.type"]).toBe("project");
  });
});

describe("slugStem", () => {
  it("retire le préfixe de type et les séparateurs", () => {
    expect(slugStem("project_un_sujet.md")).toBe("unsujet");
    expect(slugStem("reference_un_sujet.md")).toBe("unsujet");
  });

  it("traite `-` et `_` comme équivalents, dans le préfixe comme dans le radical", () => {
    expect(slugStem("project-une-chose.md")).toBe("unechose");
    expect(slugStem("project_une_chose.md")).toBe("unechose");
  });

  it("ignore un chemin de sous-dossier", () => {
    expect(slugStem("archive/project_un_sujet.md")).toBe("unsujet");
  });

  it("rend null pour une fiche sans préfixe de type reconnu", () => {
    expect(slugStem("sans-prefixe-de-type.md")).toBeNull();
    expect(slugStem("MEMORY.md")).toBeNull();
  });

  it("accepte les préfixes indépendamment de la casse du nom de fichier", () => {
    expect(slugStem("Project_Un_Sujet.md")).toBe("unsujet");
  });

  it("rend null pour un radical vide", () => {
    expect(slugStem("project_.md")).toBeNull();
  });

  it("détecte le préfixe user", () => {
    expect(slugStem("user_mon_profil.md")).toBe("monprofil");
  });
});

describe("lintFile", () => {
  it("finds nothing wrong with a valid reference memory", () => {
    expect(lintFile("ok.md", VALID_REFERENCE)).toEqual([]);
  });

  it("finds nothing wrong with a valid, non-expired project memory", () => {
    expect(lintFile("ok-projet.md", VALID_PROJECT, new Date("2026-08-14"))).toEqual([]);
  });

  it("errors on missing frontmatter entirely", () => {
    const findings = lintFile("cassé.md", "pas de frontmatter ici");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("error");
  });

  it("errors on missing name/description/type", () => {
    const findings = lintFile("incomplet.md", "---\nfoo: bar\n---\n");
    const messages = findings.map((f) => f.message);
    expect(messages.some((m) => m.includes("name"))).toBe(true);
    expect(messages.some((m) => m.includes("description"))).toBe(true);
    expect(messages.some((m) => m.includes("metadata.type"))).toBe(true);
  });

  it("errors on an invalid type", () => {
    const content = "---\nname: x\ndescription: x\nmetadata:\n  type: n-importe-quoi\n---\n";
    const findings = lintFile("x.md", content);
    expect(findings.some((f) => f.message.includes("invalide"))).toBe(true);
  });

  it("warns when a project/feedback memory has no created/expires (dated-memory convention)", () => {
    const content = "---\nname: x\ndescription: x\nmetadata:\n  type: project\n---\n";
    const findings = lintFile("x.md", content);
    expect(findings.filter((f) => f.severity === "warning")).toHaveLength(2);
  });

  it("warns when expires is in the past, but does not error", () => {
    const content = `---
name: x
description: x
metadata:
  type: project
  created: 2026-01-01
  expires: 2026-01-15
---
`;
    const findings = lintFile("x.md", content, new Date("2026-08-14"));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toContain("dépassé");
  });

  // Backlog item 41 (13/10): until now, an unparseable expiry was only
  // ever visible because checkWipLimit counted it as active. Item 41 stops
  // counting it there, so the defect needs its own warning where the rest
  // of the frontmatter is already validated — otherwise a typo'd date
  // becomes invisible to every check.
  it("flags an expires that is neither a date nor a known literal", () => {
    const findings = lintFile("typo.md", VALID_PROJECT.replace("2026-12-31", "pas-une-date"));
    expect(findings.some((f) => f.message.includes("illisible"))).toBe(true);
  });

  it("does not flag expires: closed as unreadable", () => {
    const findings = lintFile("clos.md", VALID_PROJECT.replace("2026-12-31", "closed"));
    expect(findings).toEqual([]);
  });

  it("does not flag expires: ongoing as expired", () => {
    const findings = lintFile("x.md", VALID_PROJECT.replace("2026-12-31", "ongoing"), new Date("2030-01-01"));
    expect(findings).toEqual([]);
  });

  it("flags a long file with many sections as a division candidate", () => {
    const sections = Array.from({ length: 6 }, (_, i) => `## Section ${i}\n${"ligne\n".repeat(30)}`).join("\n");
    const content = `---\nname: x\ndescription: x\nmetadata:\n  type: reference\n---\n\n${sections}`;
    const findings = lintFile("gros.md", content);
    expect(findings.some((f) => f.message.includes("division"))).toBe(true);
  });

  it("flags a file with many dated sections as journal-style", () => {
    const sections = Array.from({ length: 5 }, (_, i) => `## S${i} — 14/0${i + 1}\ncontenu`).join("\n");
    const content = `---\nname: x\ndescription: x\nmetadata:\n  type: reference\n---\n\n${sections}`;
    const findings = lintFile("journal.md", content);
    expect(findings.some((f) => f.message.includes("journal narratif"))).toBe(true);
  });

  // Backlog item 42 (13/10): the check counts dated sections, so it kept
  // re-flagging the four fiches that had already been given the exact
  // remedy its own message recommends — a head "État courant" section. A
  // report that cannot tell a treated fiche from an untreated one is
  // unusable as a work queue.
  it("does not flag journal-style when a head État courant section is present", () => {
    const findings = lintFile("traitee.md", journalWithHead("## État courant (au 13/10/2026)"));
    expect(findings.some((f) => f.message.includes("journal narratif"))).toBe(false);
  });

  it("recognises the head section even without its accent", () => {
    const findings = lintFile("traitee.md", journalWithHead("## Etat courant"));
    expect(findings.some((f) => f.message.includes("journal narratif"))).toBe(false);
  });

  it("still flags journal-style when État courant sits below the dated sections", () => {
    const findings = lintFile("journal.md", journalWithHead("## État courant", { atEnd: true }));
    expect(findings.some((f) => f.message.includes("journal narratif"))).toBe(true);
  });
});

describe("lintCorpus", () => {
  it("aggregates findings across multiple files", () => {
    const findings = lintCorpus([
      { path: "ok.md", content: VALID_REFERENCE },
      { path: "cassé.md", content: "pas de frontmatter" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toBe("cassé.md");
  });

  // Backlog item 37 (13/10): the index carries no frontmatter by
  // convention, so linting it as a memory produced the single `[error]`
  // of a 257-line report — an error that masked the fact that the corpus
  // held no real one.
  it("does not lint MEMORY.md, which carries no frontmatter by convention", () => {
    const findings = lintCorpus([
      { path: "MEMORY.md", content: INDEX_WITHOUT_FRONTMATTER },
      { path: "ok.md", content: VALID_REFERENCE },
    ]);
    expect(findings).toEqual([]);
  });

  it("does not lint a sub-index either (MEMORY-dormant.md)", () => {
    const findings = lintCorpus([
      { path: "MEMORY-dormant.md", content: INDEX_WITHOUT_FRONTMATTER },
    ]);
    expect(findings).toEqual([]);
  });

  it("still lints a real memory whose name merely contains the word memory", () => {
    const findings = lintCorpus([
      { path: "project_memory_hub.md", content: "pas de frontmatter" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("error");
  });
});

// Backlog 16/08: hybridSearch.ts silently ignores a dangling
// `superseded_by` (nothing to annotate a link to) rather than reporting
// it — this is where a dangling reference actually gets surfaced.
describe("checkSupersessionReferences", () => {
  it("flags a superseded_by that points to a file absent from the corpus", () => {
    const files = [
      { path: "old.md", content: "---\nname: old\ndescription: x\nmetadata:\n  type: reference\n  superseded_by: fantome.md\n---\n\nx" },
    ];
    const findings = checkSupersessionReferences(files);
    expect(findings).toEqual([
      expect.objectContaining({ path: "old.md", severity: "warning" }),
    ]);
    expect(findings[0]?.message).toContain("fantome.md");
  });

  it("does not flag a superseded_by that points to a real file in the corpus", () => {
    const files = [
      { path: "old.md", content: "---\nname: old\ndescription: x\nmetadata:\n  type: reference\n  superseded_by: new.md\n---\n\nx" },
      { path: "new.md", content: VALID_REFERENCE },
    ];
    expect(checkSupersessionReferences(files)).toEqual([]);
  });

  it("ignores files with no superseded_by field at all", () => {
    expect(checkSupersessionReferences([{ path: "a.md", content: VALID_REFERENCE }])).toEqual([]);
  });
});

describe("findMergeCandidates", () => {
  // One-hot-by-hash fake: identical content -> identical vector (similarity
  // 1), different content -> near-orthogonal (similarity ~0). Deliberately
  // more discriminating than a small char-bucket histogram (e.g. 3 buckets
  // of char codes mod 3) — tried that first, but two unrelated French
  // sentences still landed above 0.9 cosine similarity purely from sharing
  // a similar character distribution, not from being "the same idea". This
  // test cares about the pairing/threshold/sorting logic, not embedding
  // quality — a clean identical-vs-orthogonal fake isolates that.
  function fakeEmbed(text: string): number[] {
    const dims = 26;
    const vec = new Array(dims).fill(0);
    let hash = 0;
    for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) % dims;
    vec[hash] = 1;
    return vec;
  }

  it("flags near-identical files above the threshold", async () => {
    const files = [
      { path: "a.md", content: "contenu presque identique" },
      { path: "b.md", content: "contenu presque identique" },
      { path: "c.md", content: "tout autre chose entièrement différent" },
    ];

    const candidates = await findMergeCandidates(files, fakeEmbed, undefined, 0.99);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ a: "a.md", b: "b.md" });
  });

  it("returns nothing below the threshold", async () => {
    const files = [
      { path: "a.md", content: "aaa" },
      { path: "b.md", content: "zzz" },
    ];
    expect(await findMergeCandidates(files, fakeEmbed, undefined, 0.99)).toEqual([]);
  });

  // Backlog item 39 (13/10): on a real 222-fiche hub, 59 pairs came back at
  // 0.85 and 47 of them were feedback<->feedback, because those fiches share
  // a frontmatter block and a writing template. The similarity was measuring
  // the register, not the subject. Measured 15/10: dropping the frontmatter
  // from the compared text takes those 47 to 0.
  it("compares bodies, so identical bodies pair despite different frontmatter", async () => {
    const files = [
      { path: "a.md", content: "---\nname: a\ndescription: la fiche a\nmetadata:\n  type: feedback\n---\n\nle même corps exactement" },
      { path: "b.md", content: "---\nname: b\ndescription: tout autre chose\nmetadata:\n  type: project\n  created: 2026-01-01\n---\n\nle même corps exactement" },
    ];

    const candidates = await findMergeCandidates(files, fakeEmbed, undefined, 0.99);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ a: "a.md", b: "b.md" });
  });

  // Consequence of comparing bodies: a fiche reduced to its frontmatter now
  // has an empty body, and two empty bodies are identical. Such a fiche has
  // nothing to compare, so it must never pair rather than pair with every
  // other stub.
  it("never pairs fiches that are nothing but frontmatter", async () => {
    const files = [
      { path: "stub-a.md", content: "---\nname: a\ndescription: la fiche a\nmetadata:\n  type: reference\n---\n" },
      { path: "stub-b.md", content: "---\nname: b\ndescription: la fiche b\nmetadata:\n  type: project\n---\n" },
    ];

    expect(await findMergeCandidates(files, fakeEmbed, undefined, 0.5)).toEqual([]);
  });

  // Found on the real hub 15/10, after the two fixes above: the report
  // offered "MEMORY.md <-> feedback_garde_fous.md" at 0.867. Item 37 had
  // excluded the index from the lint, not from the duplicate detection. The
  // index is a table of contents listing every fiche, so it resembles all of
  // them a little and can never be merged into one of them.
  it("never offers the index as a merge candidate", async () => {
    const files = [
      { path: "MEMORY.md", content: "# Memory Index\n\nexactement le même contenu" },
      { path: "feedback_x.md", content: "---\nname: x\ndescription: x\nmetadata:\n  type: feedback\n---\n\nexactement le même contenu" },
    ];

    expect(await findMergeCandidates(files, fakeEmbed, undefined, 0.5)).toEqual([]);
  });

  it("sorts candidates by descending score", async () => {
    const files = [
      { path: "a.md", content: "aaa" },
      { path: "b.md", content: "aab" },
      { path: "c.md", content: "aaa" },
    ];
    const candidates = await findMergeCandidates(files, fakeEmbed, undefined, 0);
    expect(candidates[0]!.score).toBeGreaterThanOrEqual(candidates.at(-1)!.score);
  });

  // Backlog 16/08 (étude de marché Synapse, idée "Von Restorff" / mnemoverse):
  // a memory deliberately marked `protected: true` in frontmatter must never
  // become a merge candidate, even if its content is near-identical to
  // another file — the whole point is to shield a singular memory (a
  // garde-fou, say) from being silently folded into something else.
  const FRONTMATTER_BASE = "---\nname: x\ndescription: x\nmetadata:\n  type: reference";
  const FRONTMATTER_PROTECTED = `${FRONTMATTER_BASE}\n  protected: true\n---\n\ncontenu presque identique`;
  const FRONTMATTER_ORDINARY = `${FRONTMATTER_BASE}\n---\n\ncontenu presque identique`;

  it("excludes a file marked protected: true from merge-candidate pairing, even if near-identical", async () => {
    // Same frontmatter/body as the "ordinary" fixture below, save for the
    // `protected: true` line — isolates the exclusion itself rather than
    // the fake hash's sensitivity to unrelated text differences (name,
    // path...). Without that care this test can read green for the wrong
    // reason: not-yet-implemented exclusion logic masked by frontmatter
    // text alone already pushing the fake embeddings apart.
    const files = [
      { path: "a.md", content: FRONTMATTER_PROTECTED },
      { path: "b.md", content: FRONTMATTER_ORDINARY },
    ];

    const candidates = await findMergeCandidates(files, fakeEmbed, undefined, 0.99);

    expect(candidates).toEqual([]);
  });

  it("never calls embed() on a protected file's content (excluded before pairing, not just filtered from results)", async () => {
    // The outcome-level test above could pass by coincidence: two files
    // whose content differs by only the `protected: true` line will
    // already hash to different buckets under the fake embedder, similarity
    // low, no candidate — even with zero exclusion logic implemented. This
    // test is immune to that: it asserts the protected file's text never
    // reaches embed() at all, which can only be true once the exclusion is
    // real.
    const embed = vi.fn(fakeEmbed);
    const files = [
      { path: "a.md", content: FRONTMATTER_PROTECTED },
      { path: "b.md", content: FRONTMATTER_ORDINARY },
    ];

    await findMergeCandidates(files, embed, undefined, 0.99);

    const embeddedTexts = embed.mock.calls.map(([text]) => text as string);
    expect(embeddedTexts.some((t) => t.includes("protected: true"))).toBe(false);
  });

  it("still pairs two ordinary near-identical files when neither is protected (regression guard)", async () => {
    const files = [
      { path: "a.md", content: FRONTMATTER_ORDINARY },
      { path: "b.md", content: FRONTMATTER_ORDINARY },
    ];

    const candidates = await findMergeCandidates(files, fakeEmbed, undefined, 0.99);

    expect(candidates).toHaveLength(1);
  });

  // Found 16/08 by manual testing on a disposable hub (not by guessing): a
  // pair already linked via superseded_by still showed up as "fusion
  // possible" — redundant, the relationship between the two is already
  // named and resolved, suggesting a merge on top of that is noise.
  //
  // Deliberately uses a constant embed (every file maps to the same
  // vector, guaranteeing similarity 1.0 for ANY pair) rather than
  // fakeEmbed — isolates the exclusion logic itself from whether two
  // pieces of test content happen to hash into the same bucket, the exact
  // trap that produced a false-green earlier this session.
  it("does not suggest merging a pair already linked via superseded_by — that relationship is already resolved, not a duplicate to fuse", async () => {
    const alwaysSameEmbed = (): number[] => [1, 0, 0];
    const files = [
      {
        path: "old.md",
        content: "---\nname: old\ndescription: x\nmetadata:\n  type: reference\n  superseded_by: new.md\n---\n\nx",
      },
      { path: "new.md", content: "---\nname: new\ndescription: x\nmetadata:\n  type: reference\n---\n\ny" },
      { path: "other.md", content: "---\nname: other\ndescription: x\nmetadata:\n  type: reference\n---\n\nz" },
    ];

    const candidates = await findMergeCandidates(files, alwaysSameEmbed, undefined, 0.99);

    // old<->new excluded (superseded link already resolves that relationship);
    // every other pair still flagged (positive control — proves this isn't
    // just suppressing all pairing).
    expect(candidates.map((c) => [c.a, c.b].sort())).toEqual(
      expect.arrayContaining([
        ["new.md", "other.md"],
        ["old.md", "other.md"],
      ]),
    );
    expect(candidates.some((c) => [c.a, c.b].sort().join() === ["new.md", "old.md"].sort().join())).toBe(false);
  });

  // Regression: the first version called embed(f.content) directly on the
  // full raw file, bypassing chunking entirely — silently truncated by the
  // real model past its token window, one embed() call per file no matter
  // how long. Found 14/08 on the real 121-file hub via the model's own
  // "shouldn't happen" truncation warning firing for every file.
  it("chunks long files before embedding, rather than embedding the full raw content in one call", async () => {
    const embed = vi.fn(fakeEmbed);
    const longContent = "a".repeat(1000); // over chunk.ts's 500-char default
    const files = [{ path: "long.md", content: longContent }];

    await findMergeCandidates(files, embed, undefined, 0.99);

    expect(embed.mock.calls.length).toBeGreaterThan(1); // multiple chunks, not one call with the whole file
    for (const [text] of embed.mock.calls) {
      expect((text as string).length).toBeLessThan(longContent.length);
    }
  });
});

// Ajouté 16/08 (scripts/scale-test.mjs) : O(n²) mesuré a 117s pour 2000
// fichiers synthétiques — au-dela du seuil configuré, skip + avertissement
// plutot qu'un calcul potentiellement de plusieurs minutes.
describe("findMergeCandidatesGuarded", () => {
  function fakeEmbed(text: string): number[] {
    const dims = 26;
    const vec = new Array(dims).fill(0);
    let hash = 0;
    for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) % dims;
    vec[hash] = 1;
    return vec;
  }

  it("runs the real comparison when the corpus is at or under the threshold", async () => {
    const files = [
      { path: "a.md", content: "contenu presque identique" },
      { path: "b.md", content: "contenu presque identique" },
    ];

    const result = await findMergeCandidatesGuarded(files, fakeEmbed, chunkFile, 2);

    expect(result.findings).toEqual([]);
    expect(result.mergeCandidates).toHaveLength(1);
  });

  // Backlog item 39, second half: 59 suggestions is not a list anyone reads.
  // The cap is the structural guarantee that the report stays readable even
  // if the corpus grows, and it is applied here rather than inside
  // findMergeCandidates for the same reason the size guard is: the pure
  // algorithm must not silently drop results, the application layer decides
  // how many a human can act on and says so.
  describe("plafond de suggestions", () => {
    function identicalFiles(count: number): { path: string; content: string }[] {
      return Array.from({ length: count }, (_, i) => ({ path: `f${i}.md`, content: "exactement le même contenu" }));
    }

    it("caps the suggestions and says how many it held back", async () => {
      const result = await findMergeCandidatesGuarded(identicalFiles(6), fakeEmbed, chunkFile, 100, 10);

      expect(result.mergeCandidates).toHaveLength(10);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.message).toContain("15");
      expect(result.findings[0]?.message).toContain("10");
    });

    it("keeps the highest-ranked suggestions, in order", async () => {
      const files = identicalFiles(6);
      const all = await findMergeCandidates(files, fakeEmbed, chunkFile);

      const result = await findMergeCandidatesGuarded(files, fakeEmbed, chunkFile, 100, 10);

      expect(result.mergeCandidates).toEqual(all.slice(0, 10));
    });

    it("says nothing when the suggestions already fit under the cap", async () => {
      const result = await findMergeCandidatesGuarded(identicalFiles(2), fakeEmbed, chunkFile, 100, 10);

      expect(result.mergeCandidates).toHaveLength(1);
      expect(result.findings).toEqual([]);
    });
  });

  it("skips the comparison and reports why when the corpus exceeds the threshold", async () => {
    const files = [
      { path: "a.md", content: "contenu presque identique" },
      { path: "b.md", content: "contenu presque identique" },
      { path: "c.md", content: "un troisieme fichier" },
    ];

    const result = await findMergeCandidatesGuarded(files, fakeEmbed, chunkFile, 2);

    expect(result.mergeCandidates).toEqual([]);
    expect(result.findings).toEqual([
      expect.objectContaining({ path: "(corpus)", severity: "warning" }),
    ]);
  });
});

describe("checkWipLimit", () => {
  function projectFile(path: string, expires: string): { path: string; content: string } {
    return {
      path,
      content: `---\nname: ${path}\ndescription: x\nmetadata:\n  type: project\n  created: 2026-01-01\n  expires: ${expires}\n---\n`,
    };
  }

  const TODAY = new Date("2026-08-14");
  const FUTURE = "2027-12-31";

  function datedProjects(count: number): { path: string; content: string }[] {
    return Array.from({ length: count }, (_, i) => projectFile(`p${i}.md`, FUTURE));
  }

  it("returns nothing when under the limit", () => {
    expect(checkWipLimit(datedProjects(2), TODAY, 5)).toEqual([]);
  });

  it("flags when the dated deadlines exceed the limit", () => {
    const findings = checkWipLimit(datedProjects(6), TODAY, 5);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("6 projets");
  });

  // Backlog item 41 (13/10): on a real hub the count read "109 projects
  // active, indicative limit 5" and then listed all 109 paths, which is
  // unreadable and therefore unactionable. The 109 mixed three populations:
  // 52 `ongoing` (permanent by design, they will never be closed), 38 with
  // no `expires` at all, and 19 with a real future deadline. Proof the count
  // measured nothing useful: closing 10 fiches did not move it by one unit,
  // while flipping 3 dormant fiches to `ongoing` pushed it from 106 to 109.
  it("does not count `expires: ongoing` toward the limit, being permanent by design", () => {
    const files = Array.from({ length: 6 }, (_, i) => projectFile(`perm${i}.md`, "ongoing"));
    expect(checkWipLimit(files, TODAY, 5)).toEqual([]);
  });

  it("does not count a project with no expires field toward the limit", () => {
    const files = Array.from({ length: 6 }, (_, i) => ({
      path: `sans${i}.md`,
      content: `---\nname: x\ndescription: x\nmetadata:\n  type: project\n  created: 2026-01-01\n---\n`,
    }));
    expect(checkWipLimit(files, TODAY, 5)).toEqual([]);
  });

  it("names the three populations in the message instead of lumping them together", () => {
    const files = [
      ...datedProjects(6),
      projectFile("perm.md", "ongoing"),
      projectFile("perm2.md", "ongoing"),
      { path: "sans.md", content: `---\nname: x\ndescription: x\nmetadata:\n  type: project\n---\n` },
    ];
    const message = checkWipLimit(files, TODAY, 5)[0]?.message ?? "";
    expect(message).toContain("6 projets");
    expect(message).toContain("2 en `expires: ongoing`");
    expect(message).toContain("1 sans `expires`");
  });

  it("lists only the dated projects, not every project in the corpus", () => {
    const files = [...datedProjects(6), projectFile("perm.md", "ongoing")];
    const message = checkWipLimit(files, TODAY, 5)[0]?.message ?? "";
    expect(message).toContain("p0.md");
    expect(message).not.toContain("perm.md");
  });

  it("does not count expired projects toward the limit", () => {
    const files = [...datedProjects(5), projectFile("vieux.md", "2020-01-01")];
    expect(checkWipLimit(files, TODAY, 5)).toEqual([]);
  });

  it("does not count `expires: closed` toward the limit", () => {
    // `new Date("closed")` is Invalid Date, and an unparseable expiry used to
    // default to "active" — the opposite of what writing "closed" means.
    const files = [...datedProjects(5), projectFile("clos.md", "closed")];
    expect(checkWipLimit(files, TODAY, 5)).toEqual([]);
  });

  it("does not count an unreadable expiry toward the limit", () => {
    // It used to count, which was the only thing that made a typo'd date
    // visible anywhere. The limit now means "deadlines I signed up for", so
    // a malformed field is not one of them — lintFile reports it per-file
    // instead (see "flags an expires that is neither a date nor a known
    // literal"), so the signal is kept rather than moved out of reach.
    const files = [...datedProjects(5), projectFile("typo.md", "pas-une-date")];
    expect(checkWipLimit(files, TODAY, 5)).toEqual([]);
  });

  it("ignores non-project memories entirely", () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `ref${i}.md`,
      content: "---\nname: x\ndescription: x\nmetadata:\n  type: reference\n---\n",
    }));
    expect(checkWipLimit(files, new Date("2026-08-14"), 5)).toEqual([]);
  });
});
