import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hybridSearchHub } from "../src/rag/hybridSearch.js";

// Reproduces the exact failure found during the real-hub test (14/08): a
// bare acronym embeds poorly and gets missed by pure semantic search, even
// when it appears verbatim in the target file.

let hub: string;

beforeEach(() => {
  hub = mkdtempSync(join(tmpdir(), "synapse-hybrid-"));
});

afterEach(() => {
  rmSync(hub, { recursive: true, force: true });
});

describe("hybridSearchHub", () => {
  it("finds a bare acronym via exact match even though semantic search alone misses it", async () => {
    writeFileSync(join(hub, "secu.md"), "LEP (10k€) intouchable, dernier recours ; pas d'avance ESN.", "utf8");
    writeFileSync(join(hub, "autre.md"), "Recette de cuisine : faire bouillir des pâtes.", "utf8");

    const results = await hybridSearchHub(hub, "LEP", 5);

    expect(results[0]).toMatchObject({ path: "secu.md", matchType: "exact" });
  }, 120_000);

  it("does not duplicate a file that matches both exactly and semantically", async () => {
    writeFileSync(join(hub, "chat.md"), "Le chat dort sur le canapé toute la journée.", "utf8");
    writeFileSync(join(hub, "voiture.md"), "La voiture roule vite sur l'autoroute.", "utf8");

    const results = await hybridSearchHub(hub, "chat", 5);

    const chatHits = results.filter((r) => r.path === "chat.md");
    expect(chatHits).toHaveLength(1);
    expect(chatHits[0]?.matchType).toBe("exact");
  }, 120_000);
});
