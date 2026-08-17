import { describe, it, expect } from "vitest";
import { checkCitedCodeDrift } from "../src/commands/citedCodeDrift.js";

// Backlog 16/08 (étude de marché Synapse — hippo): staleness judged by
// whether the code a memory CITES has actually moved (git history),
// not by the memory's calendar age. Scoped narrowly, per feedback: only
// memories with an explicit `metadata.cites: <path>` — most of a
// personal hub's content doesn't cite code at all, this isn't a general
// staleness mechanism.
//
// gitLastCommitDate is injected (same DI pattern as embed elsewhere) —
// the real wiring shells out to `git log` against a SPECIFIC project
// root; deciding WHICH root applies to a given `cites:` reference is a
// separate, still-open question (paths are machine-specific per
// feedback_chemins_multipostes, so a bare relative path in frontmatter
// is ambiguous without a project registry Synapse doesn't have yet) —
// not solved here, this only tests the drift-detection logic itself.

const CITING = `---
name: bug-note
description: notes sur un bug dans le parseur
metadata:
  type: reference
  created: 2026-08-01
  cites: src/parser.ts
---

Le bug venait de la ligne 42.
`;

const NOT_CITING = `---
name: sans-lien
description: rien a voir avec du code
metadata:
  type: reference
---

Contenu ordinaire.
`;

describe("checkCitedCodeDrift", () => {
  it("flags a memory whose cited file changed after the memory was written", async () => {
    const files = [{ path: "bug-note.md", content: CITING }];
    const gitLastCommitDate = async (path: string) => (path === "src/parser.ts" ? "2026-08-10T00:00:00Z" : null);

    const findings = await checkCitedCodeDrift(files, gitLastCommitDate);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: "bug-note.md", severity: "warning" });
    expect(findings[0]?.message).toContain("src/parser.ts");
  });

  it("does not flag a memory whose cited file has not changed since it was written", async () => {
    const files = [{ path: "bug-note.md", content: CITING }];
    const gitLastCommitDate = async () => "2026-07-15T00:00:00Z"; // before `created`

    expect(await checkCitedCodeDrift(files, gitLastCommitDate)).toEqual([]);
  });

  it("ignores memories with no cites field at all", async () => {
    const files = [{ path: "sans-lien.md", content: NOT_CITING }];
    const gitLastCommitDate = async () => "2026-12-31T00:00:00Z";

    expect(await checkCitedCodeDrift(files, gitLastCommitDate)).toEqual([]);
  });

  it("reports (does not silently skip) a cites field with no created date to compare against", async () => {
    const content = `---\nname: x\ndescription: x\nmetadata:\n  type: reference\n  cites: src/a.ts\n---\n\nx`;
    const files = [{ path: "x.md", content }];
    const gitLastCommitDate = async () => "2026-08-10T00:00:00Z";

    const findings = await checkCitedCodeDrift(files, gitLastCommitDate);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("created");
  });

  it("reports when the cited path can't be found in git history at all (rename/typo — same spirit as checkSupersessionReferences)", async () => {
    const files = [{ path: "bug-note.md", content: CITING }];
    const gitLastCommitDate = async () => null;

    const findings = await checkCitedCodeDrift(files, gitLastCommitDate);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("introuvable");
  });
});
