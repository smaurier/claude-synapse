# Détection de doublons déterministe — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la détection de doublons par similarité cosinus par deux règles déterministes (collision de slug, recouvrement verbatim), ce qui retire l'appel au modèle d'embedding de `/brain-lint` et `/synapse-doctor`.

**Architecture:** Une nouvelle fonction pure `findDuplicateCandidates(files)` dans `src/commands/brainLint.ts`, composée de deux règles indépendantes et testables séparément, remplace `findMergeCandidates` / `findMergeCandidatesGuarded` et toute la machinerie O(n²). Les deux rapports qui la consomment perdent leur dépendance au modèle. Les invariants existants (`metadata.protected`, `metadata.superseded_by`, exclusion des index) sont conservés et testés.

**Tech Stack:** TypeScript strict, vitest, Node 22+. Aucune dépendance nouvelle. `@huggingface/transformers` reste utilisé par l'index RAG, pas par ces rapports.

**Spec:** `docs/superpowers/specs/2026-10-15-detection-doublons-design.md`

---

## Structure des fichiers

| Fichier | Responsabilité après le chantier |
|---|---|
| `src/commands/brainLint.ts` | Modifié. Gagne `slugStem`, `findSlugCollisions`, `comparableWords`, `shingles`, `containment`, `findVerbatimOverlaps`, `findDuplicateCandidates`. Perd `findMergeCandidates`, `findMergeCandidatesGuarded`, `MergeCandidate`, et les imports `cosineSimilarity` / `Chunk`. |
| `src/commands/runBrainLint.ts` | Modifié. Perd l'import et l'appel du modèle d'embedding. |
| `src/commands/synapseDoctor.ts` | Modifié. Idem. |
| `src/commands/runBrainLintCli.ts` | Modifié. Rend la règle déclenchée au lieu d'un score. |
| `src/commands/synapseDoctorCli.ts` | Modifié. Idem. |
| `src/commands/refreshIndexCli.ts` | Modifié. Un mot dans le message de l'audit périodique. |
| `src/commands/synapseConfig.ts` | Modifié. `mergeCandidatesMaxFiles` quitte `NUMERIC_EDITABLE_KEYS`. |
| `src/config/config.ts` | Modifié. `mergeCandidatesMaxFiles` quitte `SharedConfig` et ses défauts. |
| `skills/brain-lint/SKILL.md`, `skills/synapse-config/SKILL.md`, `docs/DESIGN.md` | Modifiés. Documentation alignée. |

**Fait vérifié avant d'écrire ce plan, à ne pas re-débattre :** `readSharedConfig` fait `{ ...DEFAULT_SHARED_CONFIG, ...onDisk }` (`src/config/config.ts:99`). Une clé inconnue présente sur disque est donc simplement portée sans validation ni rejet. Retirer `mergeCandidatesMaxFiles` du type **ne casse aucune configuration existante** : la clé devient inerte. La question ouverte de la spec est tranchée, aucun shim de dépréciation n'est nécessaire.

---

### Task 1: Le radical de slug

**Files:**
- Modify: `src/commands/brainLint.ts`
- Test: `tests/commands-brainLint.test.ts`

- [ ] **Step 1: Write the failing tests**

À ajouter dans `tests/commands-brainLint.test.ts`, après le `describe("extractFrontmatter", ...)` :

```typescript
describe("slugStem", () => {
  it("retire le préfixe de type et les séparateurs", () => {
    expect(slugStem("project_un_sujet.md")).toBe("unsujet");
    expect(slugStem("reference_un_sujet.md")).toBe("unsujet");
  });

  it("traite `-` et `_` comme équivalents, dans le préfixe comme dans le radical", () => {
    expect(slugStem("project-une-chose.md")).toBe(slugStem("project_une_chose.md"));
  });

  it("ignore un chemin de sous-dossier", () => {
    expect(slugStem("archive/project_un_sujet.md")).toBe("unsujet");
  });

  it("rend null pour une fiche sans préfixe de type reconnu", () => {
    expect(slugStem("sans-prefixe-de-type.md")).toBeNull();
    expect(slugStem("MEMORY.md")).toBeNull();
  });
});
```

Ajouter `slugStem` à l'import en tête du fichier de test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands-brainLint.test.ts -t "slugStem"`
Expected: FAIL, `slugStem is not a function` (ou erreur d'import TypeScript).

- [ ] **Step 3: Write minimal implementation**

À ajouter dans `src/commands/brainLint.ts`, juste avant `export interface MergeCandidate` :

```typescript
/** Préfixes de type de la convention de nommage, dans leurs deux orthographes
 *  (`project_` et `project-`) : le hub réel contient les deux. */
const SLUG_TYPE_PREFIXES = ["project", "reference", "feedback", "user"];

/**
 * Le radical d'un nom de fiche : son nom de fichier sans préfixe de type, sans
 * séparateurs et en minuscules. `null` pour une fiche dont le nom ne porte pas
 * un préfixe de type reconnu, auquel cas la règle de collision ne s'y applique
 * pas.
 */
export function slugStem(path: string): string | null {
  const basename = (path.split("/").pop() ?? path).replace(/\.md$/i, "");
  for (const prefix of SLUG_TYPE_PREFIXES) {
    for (const separator of ["_", "-"]) {
      if (basename.startsWith(prefix + separator)) {
        return basename.slice(prefix.length + 1).replace(/[-_]/g, "").toLowerCase();
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/commands-brainLint.test.ts -t "slugStem"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/brainLint.ts tests/commands-brainLint.test.ts
git commit -m "feat(lint): le radical d'un nom de fiche, base de la regle de collision"
```

---

### Task 2: La règle de collision de slug

**Files:**
- Modify: `src/commands/brainLint.ts`
- Test: `tests/commands-brainLint.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
describe("findSlugCollisions", () => {
  it("apparie deux fiches de types différents au même radical", () => {
    const pairs = findSlugCollisions(["project_un_sujet.md", "reference_un_sujet.md"]);
    expect(pairs).toEqual([
      { a: "project_un_sujet.md", b: "reference_un_sujet.md", rule: "slug", detail: "même radical `unsujet`" },
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
});
```

Ajouter `findSlugCollisions` à l'import du fichier de test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands-brainLint.test.ts -t "findSlugCollisions"`
Expected: FAIL, `findSlugCollisions is not a function`.

- [ ] **Step 3: Write minimal implementation**

Remplacer `export interface MergeCandidate { a: string; b: string; score: number; }` par :

```typescript
export type DuplicateRule = "slug" | "verbatim";

export interface DuplicateCandidate {
  a: string;
  b: string;
  rule: DuplicateRule;
  /** Pourquoi cette paire est sortie, en une phrase affichable telle quelle. */
  detail: string;
}
```

Puis ajouter, après `slugStem` :

```typescript
/**
 * Règle A de l'item 44 : deux fiches distinctes au même radical traitent le
 * même sujet sous deux étiquettes. Mesurée sur le hub réel (222 fiches) : 1
 * paire, qui était le seul vrai doublon identifié à la main, zéro faux
 * positif. Les chemins sont triés pour que la paire soit stable d'une
 * exécution à l'autre.
 */
export function findSlugCollisions(paths: string[]): DuplicateCandidate[] {
  const byStem = new Map<string, string[]>();
  for (const path of paths) {
    const stem = slugStem(path);
    if (!stem) continue;
    const group = byStem.get(stem) ?? [];
    group.push(path);
    byStem.set(stem, group);
  }

  const candidates: DuplicateCandidate[] = [];
  for (const [stem, group] of byStem) {
    if (group.length < 2) continue;
    const sorted = [...group].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        candidates.push({ a: sorted[i]!, b: sorted[j]!, rule: "slug", detail: `même radical \`${stem}\`` });
      }
    }
  }
  return candidates;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/commands-brainLint.test.ts -t "findSlugCollisions"`
Expected: PASS, 5 tests. Les anciens tests de `findMergeCandidates` sont maintenant rouges à la compilation (`MergeCandidate` n'existe plus) : c'est attendu, la Task 6 les supprime. Si le typecheck bloque la Task 2, exécuter la Task 6 d'abord.

- [ ] **Step 5: Commit**

```bash
git add src/commands/brainLint.ts tests/commands-brainLint.test.ts
git commit -m "feat(lint): regle de collision de slug, un doublon probable sans modele"
```

---

### Task 3: Le recouvrement verbatim

**Files:**
- Modify: `src/commands/brainLint.ts`
- Test: `tests/commands-brainLint.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
describe("comparableWords", () => {
  it("normalise la casse, les accents et la ponctuation", () => {
    expect(comparableWords("Été, déjà : **gras** !")).toEqual(["ete", "deja", "gras"]);
  });

  it("retire le code inline, qui n'est pas de la prose", () => {
    expect(comparableWords("avant `const x = 1` apres")).toEqual(["avant", "apres"]);
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
    expect(pairs[0]).toMatchObject({ a: "a.md", b: "b.md", rule: "verbatim" });
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
});
```

Ajouter `comparableWords` et `findVerbatimOverlaps` à l'import du fichier de test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands-brainLint.test.ts -t "Verbatim"`
Expected: FAIL, `findVerbatimOverlaps is not a function`.

- [ ] **Step 3: Write minimal implementation**

À ajouter après `findSlugCollisions` :

```typescript
const SHINGLE_SIZE = 8;
const CONTAINMENT_THRESHOLD = 0.3;

/**
 * Le texte tel qu'on le compare : minuscules, sans accents, sans code inline,
 * sans ponctuation ni marques markdown. L'ordre des opérations compte, le code
 * inline doit partir avant que les backticks ne soient effacés avec le reste de
 * la ponctuation.
 */
export function comparableWords(body: string): string[] {
  return body
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/`[^`]*`/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

export function shingles(words: string[], size = SHINGLE_SIZE): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) set.add(words.slice(i, i + size).join(" "));
  return set;
}

/** Intersection divisée par la taille du plus petit ensemble, et non Jaccard :
 *  une fiche courte entièrement absorbée dans une longue doit marquer 1, ce que
 *  Jaccard masquerait derrière la différence de taille. */
export function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const shingle of small) if (large.has(shingle)) shared++;
  return shared / small.size;
}

/**
 * Règle B de l'item 44 : deux fiches partageant de longs passages mot pour mot.
 * Mesurée sur le hub réel : **zéro paire**, le maximum observé étant 0,076 à
 * huit mots, d'où le seuil de 0,30 qui laisse un facteur quatre de marge. Elle
 * existe comme garde-fou de régression contre le copier-coller, pas comme
 * source de suggestions quotidiennes. Partager huit mots consécutifs n'arrive
 * pas par hasard, c'est ce qui rend la règle presque sans faux positif.
 */
export function findVerbatimOverlaps(files: { path: string; content: string }[]): DuplicateCandidate[] {
  const prepared = files
    .map((f) => ({ path: f.path, shingles: shingles(comparableWords(bodyWithoutFrontmatter(f.content))) }))
    .filter((f) => f.shingles.size > 0);

  const candidates: DuplicateCandidate[] = [];
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const score = containment(prepared[i]!.shingles, prepared[j]!.shingles);
      if (score < CONTAINMENT_THRESHOLD) continue;
      candidates.push({
        a: prepared[i]!.path,
        b: prepared[j]!.path,
        rule: "verbatim",
        detail: `${Math.round(score * 100)} % des suites de ${SHINGLE_SIZE} mots de la plus courte se retrouvent dans l'autre`,
      });
    }
  }
  return candidates;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/commands-brainLint.test.ts -t "Verbatim"` puis `-t "comparableWords"`
Expected: PASS, 6 tests au total.

- [ ] **Step 5: Commit**

```bash
git add src/commands/brainLint.ts tests/commands-brainLint.test.ts
git commit -m "feat(lint): recouvrement verbatim par n-grammes, garde-fou anti copier-coller"
```

---

### Task 4: La fonction composée et ses invariants

**Files:**
- Modify: `src/commands/brainLint.ts`
- Test: `tests/commands-brainLint.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
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
    const files = [
      { path: "MEMORY.md", content: "# Index\n\ncorps" },
      { path: "MEMORY-dormant.md", content: "# Sous-index\n\ncorps" },
      { path: "project_x.md", content: "---\nname: a\ndescription: x\nmetadata:\n  type: project\n---\n\ncorps" },
    ];
    expect(findDuplicateCandidates(files)).toEqual([]);
  });

  it("ne rend jamais deux fois la même paire quand les deux règles la trouvent", () => {
    const shared = "ceci est une phrase assez longue pour produire plusieurs empreintes de huit mots consecutifs sans se repeter";
    const files = [
      { path: "project_x.md", content: `---\nname: a\ndescription: x\nmetadata:\n  type: project\n---\n\n${shared}` },
      { path: "reference_x.md", content: `---\nname: b\ndescription: y\nmetadata:\n  type: reference\n---\n\n${shared}` },
    ];
    expect(findDuplicateCandidates(files)).toHaveLength(1);
  });
});
```

Ajouter `findDuplicateCandidates` à l'import du fichier de test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands-brainLint.test.ts -t "findDuplicateCandidates"`
Expected: FAIL, `findDuplicateCandidates is not a function`.

- [ ] **Step 3: Write minimal implementation**

```typescript
function pairKey(candidate: DuplicateCandidate): string {
  return [candidate.a, candidate.b].sort().join(" ");
}

/**
 * Le point d'entrée des deux rapports. Déterministe, sans modèle : il remplace
 * la comparaison O(n²) d'embeddings de l'item 39, qui mesurait le registre
 * d'écriture et pas le sujet (mesures dans la spec du 15/10).
 *
 * Les exclusions sont appliquées une fois, en amont des deux règles, pour que
 * la garantie soit inconditionnelle plutôt que « sauf si une règle future
 * filtre différemment » : `metadata.protected` (une mémoire délibérément
 * singulière ne doit jamais être proposée en fusion), les index (un sommaire
 * ressemble à tout ce qu'il liste), et les paires déjà nommées par
 * `superseded_by`. Suggestions seulement : rien n'est jamais fusionné ici.
 */
export function findDuplicateCandidates(files: { path: string; content: string }[]): DuplicateCandidate[] {
  const eligible = files.filter((f) => !isIndexFile(f.path) && !isProtected(f.content));
  const supersessionTargetByPath = new Map(eligible.map((f) => [f.path, supersessionTarget(f.content)]));

  const alreadyLinked = (candidate: DuplicateCandidate): boolean =>
    supersessionTargetByPath.get(candidate.a) === candidate.b ||
    supersessionTargetByPath.get(candidate.b) === candidate.a;

  const seen = new Set<string>();
  const candidates: DuplicateCandidate[] = [];
  // La collision de slug d'abord : c'est la règle la plus sûre, donc c'est son
  // explication qu'on garde si les deux règles trouvent la même paire.
  for (const candidate of [...findSlugCollisions(eligible.map((f) => f.path)), ...findVerbatimOverlaps(eligible)]) {
    if (alreadyLinked(candidate)) continue;
    const key = pairKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }
  return candidates;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/commands-brainLint.test.ts -t "findDuplicateCandidates"`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/brainLint.ts tests/commands-brainLint.test.ts
git commit -m "feat(lint): findDuplicateCandidates, deux regles et leurs invariants"
```

---

### Task 5: Supprimer la machinerie par embeddings

**Files:**
- Modify: `src/commands/brainLint.ts`
- Test: `tests/commands-brainLint.test.ts`

- [ ] **Step 1: Delete the obsolete tests first**

Supprimer intégralement les blocs `describe("findMergeCandidates", ...)` et `describe("findMergeCandidatesGuarded", ...)` de `tests/commands-brainLint.test.ts`, ainsi que l'import de `chunkFile` et les entrées `findMergeCandidates` / `findMergeCandidatesGuarded` de l'import en tête de fichier.

Le test `never pairs fiches that are nothing but frontmatter` et `never offers the index as a merge candidate` sont déjà couverts par la Task 3 et la Task 4 : ne pas les recopier.

- [ ] **Step 2: Delete the implementation**

Dans `src/commands/brainLint.ts`, supprimer :
- `export async function findMergeCandidates(...)` en entier,
- `export async function findMergeCandidatesGuarded(...)` en entier,
- `const DEFAULT_MAX_SUGGESTIONS = 10;`,
- les imports devenus inutiles : `import { cosineSimilarity } from "../rag/store.js";` et `import { chunkFile, type Chunk } from "../rag/chunk.js";`.

Conserver `isProtected`, `supersessionTarget`, `bodyWithoutFrontmatter` et `isIndexFile`, tous utilisés par la nouvelle fonction.

- [ ] **Step 3: Run the typecheck to find every caller left behind**

Run: `npm run typecheck`
Expected: FAIL, erreurs dans `src/commands/runBrainLint.ts`, `src/commands/synapseDoctor.ts` et leurs CLI. Ces erreurs sont la liste de travail des Tasks 6 et 7.

- [ ] **Step 4: Commit**

```bash
git add src/commands/brainLint.ts tests/commands-brainLint.test.ts
git commit -m "refactor(lint): retire la detection de fusion par similarite cosinus"
```

Le typecheck est rouge à ce commit, volontairement : il est réparé par la Task 6, et les deux commits partent dans la même PR.

---

### Task 6: Recâbler les deux rapports, sans modèle

**Files:**
- Modify: `src/commands/runBrainLint.ts`, `src/commands/synapseDoctor.ts`
- Test: `tests/commands-runBrainLint.integration.test.ts`

- [ ] **Step 1: Write the failing test**

Dans `tests/commands-runBrainLint.integration.test.ts`, remplacer toute assertion sur `mergeCandidates` par :

```typescript
it("rend des candidats de doublon sans jamais appeler le modèle d'embedding", async () => {
  // Le hub de test contient deux fiches au même radical, donc la règle de
  // collision doit sortir exactement une paire. Si un appel au modèle
  // subsistait, ce test mettrait des dizaines de secondes au lieu de
  // quelques millisecondes.
  const report = await runBrainLint(pluginDataDir);

  expect(report.duplicateCandidates).toHaveLength(1);
  expect(report.duplicateCandidates[0]?.rule).toBe("slug");
});
```

Adapter le hub de test du fichier pour qu'il contienne `project_sujet.md` et `reference_sujet.md` (suivre le helper d'écriture de fiches déjà présent dans ce fichier).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands-runBrainLint.integration.test.ts`
Expected: FAIL, `duplicateCandidates` est `undefined`.

- [ ] **Step 3: Rewrite runBrainLint.ts**

```typescript
import { readLocalConfig, defaultLocalConfigPath } from "../config/config.js";
import { loadHubCorpus } from "../rag/corpus.js";
import { lintCorpus, findDuplicateCandidates, checkWipLimit, checkSupersessionReferences, type LintFinding, type DuplicateCandidate } from "./brainLint.js";
import { checkCitedCodeDrift, createGitLastCommitDateResolver } from "./citedCodeDrift.js";

export interface BrainLintReport {
  findings: LintFinding[];
  duplicateCandidates: DuplicateCandidate[];
}

export async function runBrainLint(pluginDataDir: string): Promise<BrainLintReport> {
  const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
  const corpus = loadHubCorpus(local.hubClonePath);
  const shared = readSharedConfig(local.hubClonePath);

  const citedCodeDriftFindings = await checkCitedCodeDrift(corpus, createGitLastCommitDateResolver(local.knownProjectRoots ?? {}));

  const findings = [
    ...lintCorpus(corpus),
    ...checkWipLimit(corpus, new Date(), shared.wipLimit),
    ...checkSupersessionReferences(corpus),
    ...citedCodeDriftFindings,
  ];

  return { findings, duplicateCandidates: findDuplicateCandidates(corpus) };
}
```

Garder l'import de `readSharedConfig` (toujours nécessaire pour `wipLimit`). Mettre à jour le commentaire d'en-tête du fichier : il décrit aujourd'hui « the RAG-backed merge-candidate check », ce qui devient faux.

- [ ] **Step 4: Apply the same change to synapseDoctor.ts**

Dans `src/commands/synapseDoctor.ts` : renommer le champ `mergeCandidates` du type de rapport en `duplicateCandidates`, remplacer l'appel `findMergeCandidatesGuarded(...)` par `findDuplicateCandidates(corpus)`, supprimer `ensurePinnedEmbeddingModel(local.hubClonePath)` **uniquement si** aucun autre appel du fichier n'en dépend (vérifier avec `grep -n "embedLocal\|ensurePinned" src/commands/synapseDoctor.ts`), et retirer l'import `embeddingProvider.js` devenu inutile.

- [ ] **Step 5: Run the full suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: les tests de `brainLint` et l'intégration passent ; il reste des erreurs de typecheck dans les deux CLI, réparées par la Task 7.

- [ ] **Step 6: Commit**

```bash
git add src/commands/runBrainLint.ts src/commands/synapseDoctor.ts tests/commands-runBrainLint.integration.test.ts
git commit -m "refactor(lint): les deux rapports utilisent findDuplicateCandidates, sans modele"
```

---

### Task 7: Rendu, configuration et documentation

**Files:**
- Modify: `src/commands/runBrainLintCli.ts`, `src/commands/synapseDoctorCli.ts`, `src/commands/refreshIndexCli.ts`, `src/commands/synapseConfig.ts`, `src/config/config.ts`
- Modify: `skills/brain-lint/SKILL.md`, `skills/synapse-config/SKILL.md`, `docs/DESIGN.md`
- Test: `tests/commands-synapseConfig.test.ts`

- [ ] **Step 1: Update both renderers**

Dans `src/commands/runBrainLintCli.ts`, remplacer la boucle de rendu :

```typescript
    if (report.findings.length === 0 && report.duplicateCandidates.length === 0) {
      console.log("synapse: rien à signaler, aucun doublon détecté.");
      return;
    }

    for (const f of report.findings) {
      console.log(`[${f.severity}] ${f.path} — ${f.message}`);
    }
    for (const c of report.duplicateCandidates) {
      console.log(`[doublon probable] ${c.a} <-> ${c.b} (${c.rule} : ${c.detail})`);
    }
```

Appliquer le même rendu dans `src/commands/synapseDoctorCli.ts` (le message de vide y est `"brain-lint: rien à signaler."`, le compléter de la même façon).

Dans `src/commands/refreshIndexCli.ts:48`, remplacer `${r.mergeCandidates.length} candidat(s) fusion` par `${r.duplicateCandidates.length} doublon(s) probable(s)`.

- [ ] **Step 2: Write the failing config test**

Dans `tests/commands-synapseConfig.test.ts`, trouver l'assertion qui liste `NUMERIC_EDITABLE_KEYS` et la mettre à jour :

```typescript
it("n'expose plus mergeCandidatesMaxFiles, la detection n'a plus de seuil de taille", () => {
  expect(NUMERIC_EDITABLE_KEYS).not.toContain("mergeCandidatesMaxFiles");
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/commands-synapseConfig.test.ts`
Expected: FAIL, la clé est encore présente.

- [ ] **Step 4: Remove the config key**

Dans `src/commands/synapseConfig.ts:19`, retirer `"mergeCandidatesMaxFiles"` de `NUMERIC_EDITABLE_KEYS`.
Dans `src/config/config.ts`, retirer le champ `mergeCandidatesMaxFiles: number;` de `SharedConfig` (ligne 47 et son commentaire) et `mergeCandidatesMaxFiles: 500,` de `DEFAULT_SHARED_CONFIG` (ligne 86).

Aucun shim n'est nécessaire : `readSharedConfig` fusionne par spread, donc une clé restée sur disque est portée sans être lue ni rejetée.

- [ ] **Step 5: Update the documentation**

- `skills/brain-lint/SKILL.md:21` : retirer la phrase sur `mergeCandidatesMaxFiles` et le saut de la détection, remplacer par la description des deux règles et le fait que le rapport est déterministe et sans modèle.
- `skills/synapse-config/SKILL.md:22` : retirer `mergeCandidatesMaxFiles` de la liste des clés numériques éditables, et vérifier que le compte annoncé de clés reste juste.
- `docs/DESIGN.md:103` : remplacer le paragraphe sur le saut au-delà de 500 fichiers par les deux règles et un renvoi à `docs/superpowers/specs/2026-10-15-detection-doublons-design.md`.

- [ ] **Step 6: Run everything**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: tout vert, aucune erreur, `dist/` recompilé.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(lint): rendu par regle, retrait de mergeCandidatesMaxFiles, doc alignee"
```

---

### Task 8: Vérifier le critère falsifiable sur le hub réel, puis livrer

**Files:**
- Create: fichier de mesure jetable dans le répertoire temporaire de la session, **jamais dans le dépôt**

- [ ] **Step 1: Measure on the real hub**

Écrire un script jetable qui charge le corpus via `dist/rag/corpus.js` et appelle `findDuplicateCandidates`, puis l'exécuter sur le hub de référence. Chronométrer.

Attendu, les trois points du critère de la spec :
1. exactement **1 paire**, la collision de slug connue ;
2. **aucun appel au modèle** : la mesure doit durer moins d'une seconde, contre environ 145 secondes avant ;
3. la sortie nomme la règle déclenchée.

- [ ] **Step 2: If the result differs from 1 pair, stop and investigate**

Ne pas ajuster le seuil pour faire tomber le chiffre juste. Si une paire inattendue sort, la lire : soit c'est un vrai doublon de plus (bonne nouvelle, le noter), soit la règle a un défaut (le corriger par un test rouge). La leçon de l'item 39 est de ne jamais plier la mesure au critère.

- [ ] **Step 3: Open the pull request**

⚠️ **Avant d'écrire le corps de la PR et le message de commit : relire la règle du hub privé sur les artefacts publics.** Ce dépôt est public. Donner les chiffres et les durées, décrire les fiches par leur type, jamais par leur nom. Vérification en deux secondes :

```bash
grep -oE "(project|feedback|user|reference|ticket)[-_][a-z0-9_-]+" <fichier du corps de PR>
```

- [ ] **Step 4: Merge after green CI, delete the branch**

Branche, PR, CI verte sur Ubuntu et Windows, merge, suppression de la branche.

- [ ] **Step 5: Close the loop in the private hub**

Marquer l'item 44 comme fait dans `backlog-claude-synapse.md` avec les chiffres mesurés, mettre à jour la ligne d'index de `MEMORY.md` (compte de tests, et le fait que `/brain-lint` est désormais sans modèle), committer et pousser le hub.

---

## Auto-revue du plan

**Couverture de la spec**, section par section :

| Exigence de la spec | Task |
|---|---|
| Règle A, collision de slug, par radical normalisé | 1, 2 |
| Règle B, n-grammes de 8 mots, containment 0,30 | 3 |
| `metadata.protected` exclut | 4 |
| `superseded_by` écarte | 4 |
| Index et sous-index écartés | 4 |
| Rien n'est jamais fusionné automatiquement | acquis, aucune écriture dans ces fonctions |
| Retrait de `findMergeCandidates` et du O(n²) | 5 |
| Retrait du modèle dans les deux rapports | 6 |
| Le rapport annonce l'absence de doublon | 7, step 1 |
| La suggestion nomme sa règle | 7, step 1 |
| `mergeCandidatesMaxFiles` devenu inutile | 7, steps 2 à 4, question tranchée en tête de plan |
| Critère falsifiable vérifié sur le hub | 8 |

**Placeholders** : aucun. Chaque étape de code porte son code.

**Cohérence des types** : `DuplicateCandidate { a, b, rule, detail }` est défini en Task 2 et utilisé tel quel en 3, 4, 6 et 7. `DuplicateRule` vaut `"slug" | "verbatim"`, les deux valeurs étant produites respectivement en Task 2 et Task 3. Le champ de rapport s'appelle `duplicateCandidates` partout (Tasks 6, 7, 8).

**Ordre** : la Task 5 laisse volontairement le typecheck rouge, réparé en Task 6. Si l'exécutant préfère ne jamais committer un état rouge, exécuter 5, 6 et 7 d'affilée avant de committer, en un seul commit de refactor.
