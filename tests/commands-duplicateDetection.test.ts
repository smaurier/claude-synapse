import { describe, it, expect } from "vitest";
import {
  slugStem,
  findSlugCollisions,
  comparableWords,
  shingles,
  containment,
  findVerbatimOverlaps,
  findDuplicateCandidates,
  formatDuplicateCandidate,
} from "../src/commands/duplicateDetection.js";
import { VALID_TYPES } from "../src/commands/brainLint.js";

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

  it("reconnaît un préfixe pour chacun des VALID_TYPES — les deux listes ne doivent jamais diverger", () => {
    // Garde-fou de régression (item 44, point 7) : SLUG_TYPE_PREFIXES dérive
    // de VALID_TYPES dans brainLint.ts ; ce test échoue si quelqu'un les
    // sépare à nouveau sans mettre à jour les deux, ou ajoute un cinquième
    // type sans que la règle de collision de slug le reconnaisse.
    for (const type of VALID_TYPES) {
      expect(slugStem(`${type}_sujet.md`)).toBe("sujet");
    }
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
