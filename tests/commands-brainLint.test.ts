import { describe, it, expect } from "vitest";
import { extractFrontmatter, lintFile, lintCorpus, checkWipLimit, checkSupersessionReferences, checkIndexLinks, checkIndexWeight } from "../src/commands/brainLint.js";

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

  // Backlog item 40 (13/10/2026) : 9 des 14 `expires` dépassés trouvés ce jour-là
  // portaient déjà leur verdict dans leur propre `description` (CLOS, STOPPÉE, PAS
  // RETENU, DÉCLINÉ, COMPLET ET DÉPLOYÉ, PERDU, RÉSOLU...). Une règle lexicale les
  // détecte et propose `expires: closed` — en PROPOSITION seulement, jamais en
  // auto-fix (doctrine du skill, item 49).
  describe("overdue expires with a closure marker already in the description", () => {
    function overdueWithDescription(description: string): string {
      return `---\nname: x\ndescription: "${description}"\nmetadata:\n  type: project\n  created: 2026-01-01\n  expires: 2026-01-15\n---\n`;
    }

    it("proposes expires: closed when the description already says CLOS", () => {
      const findings = lintFile("x.md", overdueWithDescription("Dossier Alstom — CLOS le 16/09/2026"), new Date("2026-08-14"));
      const proposal = findings.find((f) => f.message.includes("expires: closed"));
      expect(proposal).toBeDefined();
      expect(proposal?.severity).toBe("warning");
    });

    it.each(["STOPPÉE", "PAS RETENU", "DÉCLINÉ", "COMPLET ET DÉPLOYÉ", "PERDU", "RÉSOLU", "ABANDONNÉE"])(
      "recognizes the marker %s",
      (marker) => {
        const findings = lintFile("x.md", overdueWithDescription(`Projet — ${marker} le 01/01/2026`), new Date("2026-08-14"));
        expect(findings.some((f) => f.message.includes("expires: closed"))).toBe(true);
      },
    );

    it("is case-insensitive and accent-insensitive", () => {
      const findings = lintFile("x.md", overdueWithDescription("resolu le 01/01/2026"), new Date("2026-08-14"));
      expect(findings.some((f) => f.message.includes("expires: closed"))).toBe(true);
    });

    it("does not propose it when the description has no closure marker", () => {
      const findings = lintFile("x.md", overdueWithDescription("Projet toujours en cours, rien de tranché"), new Date("2026-08-14"));
      expect(findings.some((f) => f.message.includes("expires: closed"))).toBe(false);
    });

    it("does not propose it when expires is not actually overdue", () => {
      const findings = lintFile("x.md", overdueWithDescription("CLOS le 16/09/2026"), new Date("2026-01-01"));
      expect(findings.some((f) => f.message.includes("expires: closed"))).toBe(false);
    });
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

// Backlog item 38 (13/10/2026) : rien ne vérifiait les liens markdown de
// `MEMORY.md`/`MEMORY-*.md` vers les fiches, ni l'absence d'une fiche dans l'index.
// Mesuré à la main ce jour-là : 187 liens cités, 0 cassé, 1 orpheline — bon résultat,
// mais garanti par rien. Deux signaux distincts : lien cité sans fichier, fichier
// sans ligne d'index.
describe("checkIndexLinks", () => {
  it("flags a link in the index pointing to a file absent from the corpus", () => {
    const files = [
      { path: "MEMORY.md", content: "# Index\n\n- [Un truc](fantome.md)\n" },
    ];
    const findings = checkIndexLinks(files);
    expect(findings).toEqual([
      expect.objectContaining({ path: "MEMORY.md", severity: "warning" }),
    ]);
    expect(findings[0]?.message).toContain("fantome.md");
  });

  it("does not flag a link pointing to a real corpus file", () => {
    const files = [
      { path: "MEMORY.md", content: "# Index\n\n- [Une fiche](a.md)\n" },
      { path: "a.md", content: VALID_REFERENCE },
    ];
    expect(checkIndexLinks(files)).toEqual([]);
  });

  it("flags a non-index file never linked from any index", () => {
    const files = [
      { path: "MEMORY.md", content: "# Index\n\n- [Une fiche](a.md)\n" },
      { path: "a.md", content: VALID_REFERENCE },
      { path: "orpheline.md", content: VALID_REFERENCE },
    ];
    const findings = checkIndexLinks(files);
    expect(findings).toEqual([
      expect.objectContaining({ path: "orpheline.md", severity: "warning" }),
    ]);
    expect(findings[0]?.message).toContain("aucune ligne d'index");
  });

  it("checks links across every index file, not just MEMORY.md", () => {
    const files = [
      { path: "MEMORY.md", content: "# Index\n\nSous-index : [dormant](MEMORY-dormant.md)\n" },
      { path: "MEMORY-dormant.md", content: "- [Une fiche](a.md)\n" },
      { path: "a.md", content: VALID_REFERENCE },
    ];
    expect(checkIndexLinks(files)).toEqual([]);
  });

  it("ignores external links (http/https) when checking for broken targets", () => {
    const files = [
      { path: "MEMORY.md", content: "# Index\n\n- [Externe](https://example.com/page.md)\n" },
    ];
    expect(checkIndexLinks(files)).toEqual([]);
  });

  it("ignores a memory file with no frontmatter type at all (not a real memory, e.g. a stray doc)", () => {
    // Un fichier sans frontmatter n'est de toute façon pas une vraie fiche —
    // `lintFile` le signale déjà en erreur ailleurs ; checkIndexLinks ne double pas ce signal.
    const files = [
      { path: "MEMORY.md", content: "# Index\n" },
      { path: "README.md", content: "juste un fichier markdown sans frontmatter" },
    ];
    expect(checkIndexLinks(files)).toEqual([]);
  });
});

// Backlog item 36 (13/10/2026) : `MEMORY.md` est le seul fichier payé à CHAQUE
// `SessionStart`, quel que soit le sujet — et rien ne mesurait son poids ni sa
// répartition par section. Mesuré à la main ce jour sur un vrai hub : Feedback
// (4296 o) en tête, loin devant les autres sections.
describe("checkIndexWeight", () => {
  function section(heading: string, byteCount: number): string {
    return `## ${heading}\n${"x".repeat(Math.max(0, byteCount - heading.length - 4))}\n`;
  }

  it("does not flag MEMORY.md when it stays under the threshold", () => {
    const files = [{ path: "MEMORY.md", content: `# Index\n\n${section("Feedback", 100)}` }];
    expect(checkIndexWeight(files, 1000)).toEqual([]);
  });

  it("flags MEMORY.md and names the heaviest section first once over the threshold", () => {
    const files = [
      {
        path: "MEMORY.md",
        content: `# Index\n\n${section("Garde-fous", 200)}${section("Feedback", 4296)}${section("En cours", 2352)}`,
      },
    ];
    const findings = checkIndexWeight(files, 1000);
    expect(findings).toEqual([expect.objectContaining({ path: "MEMORY.md", severity: "warning" })]);
    const feedbackPos = findings[0]!.message.indexOf("Feedback");
    const enCoursPos = findings[0]!.message.indexOf("En cours");
    const gardeFousPos = findings[0]!.message.indexOf("Garde-fous");
    expect(feedbackPos).toBeGreaterThanOrEqual(0);
    expect(feedbackPos).toBeLessThan(enCoursPos);
    expect(enCoursPos).toBeLessThan(gardeFousPos);
  });

  it("only ever looks at MEMORY.md itself, not the sub-indexes loaded on demand", () => {
    const files = [
      { path: "MEMORY.md", content: "# Index\n\nminuscule\n" },
      { path: "MEMORY-dormant.md", content: `# Dormant\n\n${section("Gros", 5000)}` },
    ];
    expect(checkIndexWeight(files, 1000)).toEqual([]);
  });

  it("is a no-op when the corpus has no MEMORY.md at all", () => {
    expect(checkIndexWeight([{ path: "a.md", content: VALID_REFERENCE }], 1000)).toEqual([]);
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
