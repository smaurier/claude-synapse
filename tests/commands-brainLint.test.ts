import { describe, it, expect } from "vitest";
import { extractFrontmatter, lintFile, lintCorpus, findMergeCandidates } from "../src/commands/brainLint.js";

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

    const candidates = await findMergeCandidates(files, fakeEmbed, 0.99);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ a: "a.md", b: "b.md" });
  });

  it("returns nothing below the threshold", async () => {
    const files = [
      { path: "a.md", content: "aaa" },
      { path: "b.md", content: "zzz" },
    ];
    expect(await findMergeCandidates(files, fakeEmbed, 0.99)).toEqual([]);
  });

  it("sorts candidates by descending score", async () => {
    const files = [
      { path: "a.md", content: "aaa" },
      { path: "b.md", content: "aab" },
      { path: "c.md", content: "aaa" },
    ];
    const candidates = await findMergeCandidates(files, fakeEmbed, 0);
    expect(candidates[0]!.score).toBeGreaterThanOrEqual(candidates.at(-1)!.score);
  });
});
