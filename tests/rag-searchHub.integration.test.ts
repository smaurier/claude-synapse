import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchHub } from "../src/rag/searchHub.js";

// Real model, real tokenizer, real corpus walk on an actual directory — the
// end-to-end proof for the piece that will sit behind bin/brain-search.
// Slow (model load + WASM inference), kept in its own file, same rationale
// as the other *.integration.test.ts files.

let hub: string;

beforeEach(() => {
  hub = mkdtempSync(join(tmpdir(), "synapse-search-hub-"));
});

afterEach(() => {
  rmSync(hub, { recursive: true, force: true });
});

describe("searchHub", () => {
  it("finds the most relevant memory file in a real hub directory", async () => {
    writeFileSync(join(hub, "chat.md"), "Le chat dort sur le canapé toute la journée.", "utf8");
    mkdirSync(join(hub, "sous-dossier"), { recursive: true });
    writeFileSync(
      join(hub, "sous-dossier", "voiture.md"),
      "La voiture roule vite sur l'autoroute.",
      "utf8",
    );

    const results = await searchHub(hub, "un félin qui fait la sieste", 1);

    expect(results[0]?.path).toBe("chat.md");
  }, 30_000);

  it("never indexes its own .synapse directory as memory content", async () => {
    writeFileSync(join(hub, "chat.md"), "Le chat dort sur le canapé.", "utf8");

    const results = await searchHub(hub, "chat", 10);

    expect(results.every((r) => !r.path.startsWith(".synapse"))).toBe(true);
    expect(existsSync(join(hub, ".synapse", "index.sqlite"))).toBe(true);
  }, 30_000);
});
