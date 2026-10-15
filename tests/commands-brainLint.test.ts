import { describe, it, expect } from "vitest";
import { extractFrontmatter, lintFile, lintCorpus, checkWipLimit, checkSupersessionReferences, slugStem, findSlugCollisions, comparableWords, findVerbatimOverlaps, shingles, containment, findDuplicateCandidates, formatDuplicateCandidate } from "../src/commands/brainLint.js";

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

describe("findSlugCollisions", () => {
  it("apparie deux fiches de types différents au même radical", () => {
    const pairs = findSlugCollisions(["project_un_sujet.md", "reference_un_sujet.md"]);
    expect(pairs).toEqual([
      { a: "project_un_sujet.md", b: "reference_un_sujet.md", rule: "slug", stem: "unsujet" },
    ]);
  });

  it("apparie deux fiches du même type dont seuls les séparateurs diffèrent", () => {
    const pairs = findSlugCollisions(["project-une-chose.md", "project_une_chose.md"]);
    expect(pairs).toHaveLength(1);
  });

  it("n'apparie pas deux radicaux différents", () => {
    expect(findSlugCollisions(["project_a.md", "reference_b.md"])).toEqual([]);
  });

  it("ignore les fiches sans préfixe de type", () => {
    expect(findSlugCollisions(["sans-prefixe.md", "autre_fichier.md"])).toEqual([]);
  });

  it("rend toutes les paires d'un groupe de trois", () => {
    const pairs = findSlugCollisions(["project_x.md", "reference_x.md", "feedback_x.md"]);
    expect(pairs).toHaveLength(3);
  });

  it("n'apparie pas un fichier avec lui-même en cas de doublure dans l'entrée", () => {
    expect(findSlugCollisions(["project_x.md", "project_x.md"])).toEqual([]);
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

describe("comparableWords", () => {
  it("normalise la casse, les accents et la ponctuation", () => {
    expect(comparableWords("Été, déjà : **gras** !")).toEqual(["ete", "deja", "gras"]);
  });

  it("retire le code inline, qui n'est pas de la prose", () => {
    expect(comparableWords("avant `const x = 1` apres")).toEqual(["avant", "apres"]);
  });
});

describe("shingles", () => {
  it("honore le paramètre size et n'utilise jamais une valeur par défaut implicite", () => {
    const words = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const size6 = shingles(words, 6);
    const size8 = shingles(words, 8);
    expect(size6.size).toBe(5); // 10 - 6 + 1
    expect(size8.size).toBe(3); // 10 - 8 + 1
    expect(size6.size).not.toBe(size8.size);
  });
});

describe("findVerbatimOverlaps", () => {
  const LONG = "ceci est une phrase assez longue pour produire plusieurs empreintes de huit mots consecutifs sans se repeter du tout";

  it("apparie deux corps partageant un long passage mot pour mot", () => {
    const files = [
      { path: "a.md", content: `---\nname: a\ndescription: x\nmetadata:\n  type: project\n---\n\n${LONG}` },
      { path: "b.md", content: `---\nname: b\ndescription: y\nmetadata:\n  type: reference\n---\n\n${LONG}` },
    ];
    const pairs = findVerbatimOverlaps(files);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: "a.md", b: "b.md", rule: "verbatim", shingleSize: 8 });
  });

  it("n'apparie pas deux corps au vocabulaire proche mais sans passage commun", () => {
    const files = [
      { path: "a.md", content: "le chat dort sur le tapis rouge du salon pendant que la pluie tombe" },
      { path: "b.md", content: "un tapis rouge attend dans le salon et la pluie continue de tomber ce soir" },
    ];
    expect(findVerbatimOverlaps(files)).toEqual([]);
  });

  it("ne compare jamais le frontmatter, identique d'une fiche à l'autre", () => {
    const sameFrontmatter = "---\nname: n\ndescription: une description strictement identique sur les deux fiches ici\nmetadata:\n  type: feedback\n  created: 2026-01-01\n  expires: ongoing\n---\n\n";
    const files = [
      { path: "a.md", content: `${sameFrontmatter}corps completement different du second avec ses propres mots a lui` },
      { path: "b.md", content: `${sameFrontmatter}rien a voir ici, autre sujet, autres termes, aucune phrase partagee` },
    ];
    expect(findVerbatimOverlaps(files)).toEqual([]);
  });

  it("n'apparie pas une fiche réduite à son frontmatter", () => {
    const files = [
      { path: "a.md", content: "---\nname: a\ndescription: x\nmetadata:\n  type: project\n---\n" },
      { path: "b.md", content: "---\nname: b\ndescription: y\nmetadata:\n  type: project\n---\n" },
    ];
    expect(findVerbatimOverlaps(files)).toEqual([]);
  });

  it("encadre le seuil par le haut : partage 5 shingles sur 9 = 0.556, détecte", () => {
    // Body A: 16 words → 9 shingles (16 - 8 + 1)
    const bodyA =
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen";
    // Body B: 17 words → 10 shingles, 5 shingles initiaux partagés avec A
    // "one two ... twelve extra extra different stuff here" → seulement les 5 premiers huit-grammes matchent
    const bodyB = "one two three four five six seven eight nine ten eleven twelve extra extra different stuff here";

    const files = [
      { path: "a.md", content: `---\nname: a\nmetadata:\n  type: feedback\n---\n\n${bodyA}` },
      { path: "b.md", content: `---\nname: b\nmetadata:\n  type: feedback\n---\n\n${bodyB}` },
    ];

    const pairs = findVerbatimOverlaps(files);
    expect(pairs).toHaveLength(1);
    // 5 shared shingles / 9 total in min(sets) = 5/9 ≈ 0.556
    expect(pairs[0]?.containment).toBeCloseTo(5 / 9, 3);
    expect(pairs[0]?.containment).toBeGreaterThan(0.3);
  });

  it("encadre le seuil par le bas : partage 1 shingle sur 9 = 0.111, ne détecte pas", () => {
    // Body A: 16 words → 9 shingles
    const bodyA =
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen";
    // Body B: 16 words → 9 shingles, seulement le premier huit-gramme matche
    const bodyB = "one two three four five six seven eight completely different text here now extra words more";

    const files = [
      { path: "a.md", content: `---\nname: a\nmetadata:\n  type: feedback\n---\n\n${bodyA}` },
      { path: "b.md", content: `---\nname: b\nmetadata:\n  type: feedback\n---\n\n${bodyB}` },
    ];

    const pairs = findVerbatimOverlaps(files);
    expect(pairs).toHaveLength(0); // 1/9 ≈ 0.111 < 0.3, no match
  });
});

describe("findDuplicateCandidates", () => {
  const PROTECTED = "---\nname: g\ndescription: x\nmetadata:\n  type: feedback\n  protected: true\n---\n\ncorps";

  it("réunit les deux règles", () => {
    const files = [
      { path: "project_x.md", content: "---\nname: a\ndescription: x\nmetadata:\n  type: project\n---\n\ncorps a" },
      { path: "reference_x.md", content: "---\nname: b\ndescription: y\nmetadata:\n  type: reference\n---\n\ncorps b" },
    ];
    const pairs = findDuplicateCandidates(files);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.rule).toBe("slug");
  });

  it("n'appaire jamais une fiche `protected`", () => {
    const files = [
      { path: "project_x.md", content: PROTECTED },
      { path: "reference_x.md", content: "---\nname: b\ndescription: y\nmetadata:\n  type: reference\n---\n\ncorps" },
    ];
    expect(findDuplicateCandidates(files)).toEqual([]);
  });

  it("écarte une paire déjà liée par superseded_by", () => {
    const files = [
      { path: "project_x.md", content: "---\nname: a\ndescription: x\nmetadata:\n  type: project\n  superseded_by: reference_x.md\n---\n\ncorps" },
      { path: "reference_x.md", content: "---\nname: b\ndescription: y\nmetadata:\n  type: reference\n---\n\ncorps" },
    ];
    expect(findDuplicateCandidates(files)).toEqual([]);
  });

  it("écarte l'index et les sous-index", () => {
    // The index resembles everything it lists. On the real hub, MEMORY.md was
    // proposed for merge with an ordinary fiche at 0.867 similarity via the
    // verbatim rule (8-word shingles, containment 1.0 if they share a body).
    // This fixture gives both the index and two ordinary fiches the exact same
    // long body, so they WOULD pair via verbatim overlaps if the index were
    // not filtered upfront.
    const shared = "ceci est une longue phrase avec beaucoup de mots pour fabriquer des shingles de huit mots sans probleme du tout";
    const files = [
      { path: "MEMORY.md", content: shared },
      { path: "MEMORY-dormant.md", content: shared },
      { path: "project_x.md", content: `---\nname: a\ndescription: x\nmetadata:\n  type: project\n---\n\n${shared}` },
      { path: "project_y.md", content: `---\nname: b\ndescription: y\nmetadata:\n  type: project\n---\n\n${shared}` },
    ];
    // With the guard: only the two ordinary fiches can pair (the index and
    // sub-index are filtered). So we get one pair: project_x <-> project_y.
    const pairs = findDuplicateCandidates(files);
    expect(pairs).toHaveLength(1);
    expect([pairs[0]?.a, pairs[0]?.b].sort()).toEqual(["project_x.md", "project_y.md"]);
  });

  it("ne rend jamais deux fois la même paire quand les deux règles la trouvent", () => {
    const shared = "ceci est une phrase assez longue pour produire plusieurs empreintes de huit mots consecutifs sans se repeter";
    const files = [
      { path: "project_x.md", content: `---\nname: a\ndescription: x\nmetadata:\n  type: project\n---\n\n${shared}` },
      { path: "reference_x.md", content: `---\nname: b\ndescription: y\nmetadata:\n  type: reference\n---\n\n${shared}` },
    ];
    expect(findDuplicateCandidates(files)).toHaveLength(1);
  });

  it("déduplication fonctionne même quand les deux règles émettent la paire en ordres différents (avec ordre d'entrée inversé)", () => {
    // findSlugCollisions trie ses groupes, mais findVerbatimOverlaps émet les
    // paires en ordre d'entrée. Quand la même paire est trouvée par les deux
    // règles ET que l'ordre d'entrée est inversé (les fichiers arrivent dans
    // l'ordre inverse de leur sort alphabétique), les deux règles émettent la
    // paire avec a et b inversés l'une par rapport à l'autre. Le seul rempart
    // est le `.sort()` dans pairKey. Sans lui, on rendrait la même paire deux fois.
    const shared = "ceci est une phrase assez longue pour produire plusieurs empreintes de huit mots consecutifs sans se repeter";
    const files = [
      // Ordre d'entrée inversé : reference_x avant project_x
      { path: "reference_x.md", content: `---\nname: b\ndescription: y\nmetadata:\n  type: reference\n---\n\n${shared}` },
      { path: "project_x.md", content: `---\nname: a\ndescription: x\nmetadata:\n  type: project\n---\n\n${shared}` },
    ];
    const pairs = findDuplicateCandidates(files);
    expect(pairs).toHaveLength(1);
    expect([pairs[0]?.a, pairs[0]?.b].sort()).toEqual(["project_x.md", "reference_x.md"]);
  });

  it("écarte une paire superseded_by même quand le pointeur sort alphabétiquement APRÈS sa cible", () => {
    // L'ordre dans lequel une paire arrive (qui est a, qui est b) dépend de
    // l'ordre d'entrée des fichiers, pas de qui supersede qui. Le test précédent
    // (écarte une paire déjà liée) couvre le cas où le pointeur sort avant sa cible.
    // Celui-ci couvre l'inverse. alreadyLinked doit vérifier les DEUX directions :
    // get(a) === b ET get(b) === a.
    const files = [
      { path: "project_x.md", content: "---\nname: new\ndescription: y\nmetadata:\n  type: project\n---\n\ncorps" },
      { path: "user_x.md", content: "---\nname: old\ndescription: x\nmetadata:\n  type: user\n  superseded_by: project_x.md\n---\n\ncorps" },
    ];
    // project_x.md sorts avant user_x.md (p < u), donc la paire arrivera avec
    // a=project_x.md, b=user_x.md. Pour que alreadyLinked le détecte, il faut
    // la deuxième clause : supersessionTargetByPath.get(b) === a.
    expect(findDuplicateCandidates(files)).toEqual([]);
  });

  // Jusqu'ici, chaque test de ce describe utilise des chemins qui collisionnent
  // par radical, donc la règle slug fire toujours et masque la question : la
  // fonction composée rend-elle vraiment un `rule: "verbatim"` seule, sans
  // aucune collision de radical en jeu ? "doc-un.md"/"doc-deux.md" ne portent
  // aucun des préfixes de SLUG_TYPE_PREFIXES, donc slugStem rend null pour les
  // deux : la règle slug ne peut matériellement pas fire ici, par construction
  // du nom de fichier, pas par coïncidence de contenu.
  it("rend un candidat `rule: verbatim` quand seul le recouvrement de passage déclenche, sans collision de radical possible", () => {
    // Mêmes corps que le test d'encadrement par le haut de findVerbatimOverlaps
    // (5 shingles partagés sur 9 dans le plus petit ensemble).
    const bodyA =
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen";
    const bodyB = "one two three four five six seven eight nine ten eleven twelve extra extra different stuff here";

    const files = [
      { path: "doc-un.md", content: `---\nname: a\ndescription: x\nmetadata:\n  type: reference\n---\n\n${bodyA}` },
      { path: "doc-deux.md", content: `---\nname: b\ndescription: y\nmetadata:\n  type: reference\n---\n\n${bodyB}` },
    ];

    // Containment calculé via les primitives de la librairie elle-même,
    // jamais deviné — même exigence que les tests d'encadrement de seuil de
    // findVerbatimOverlaps.
    const expectedContainment = containment(shingles(comparableWords(bodyA), 8), shingles(comparableWords(bodyB), 8));

    const pairs = findDuplicateCandidates(files);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.rule).toBe("verbatim");
    expect(pairs[0]).toMatchObject({ rule: "verbatim", shingleSize: 8 });
    expect(pairs[0]?.containment).toBeCloseTo(expectedContainment, 10);
    expect(expectedContainment).toBeGreaterThan(0.3); // sinon le test ne prouverait rien
  });
});

describe("formatDuplicateCandidate", () => {
  it("nomme le radical sur la branche slug", () => {
    const line = formatDuplicateCandidate({ a: "project_x.md", b: "reference_x.md", rule: "slug", stem: "x" });
    expect(line).toBe("[doublon probable] project_x.md <-> reference_x.md (même radical `x`)");
  });

  it("rend le containment en pourcentage arrondi avec la taille de shingle, sur la branche verbatim", () => {
    const line = formatDuplicateCandidate({ a: "a.md", b: "b.md", rule: "verbatim", containment: 0.556, shingleSize: 8 });
    expect(line).toBe("[doublon probable] a.md <-> b.md (56 % des suites de 8 mots de la plus courte se retrouvent dans l'autre)");
  });

  it("arrondit le containment plutôt que de le tronquer (0.555 -> 56 %, pas 55 %)", () => {
    const line = formatDuplicateCandidate({ a: "a.md", b: "b.md", rule: "verbatim", containment: 0.555, shingleSize: 8 });
    expect(line).toContain("56 %");
  });
});
