import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchHub, refreshHubIndex } from "../src/rag/searchHub.js";
import { rmTree } from "./helpers/fsTemp.js";
import { describeWithModel } from "./helpers/model.js";

// Real model, real tokenizer, real corpus walk on an actual directory — the
// end-to-end proof for the piece that will sit behind bin/brain-search.
// Slow (model load + WASM inference), kept in its own file, same rationale
// as the other *.integration.test.ts files.

let hub: string;

beforeEach(() => {
  hub = mkdtempSync(join(tmpdir(), "synapse-search-hub-"));
});

afterEach(() => {
  rmTree(hub);
});

describeWithModel("searchHub", () => {
  it("finds the most relevant memory file in a real hub directory", async () => {
    writeFileSync(join(hub, "chat.md"), "Le chat dort sur le canapé toute la journée.", "utf8");
    mkdirSync(join(hub, "sous-dossier"), { recursive: true });
    writeFileSync(
      join(hub, "sous-dossier", "voiture.md"),
      "La voiture roule vite sur l'autoroute.",
      "utf8",
    );

    // See rag-production.integration.test.ts for why this query is a real
    // paraphrase ("un animal qui dort...") rather than the rare synonym
    // "félin", which this model was measured not to handle reliably.
    const results = await searchHub(hub, "un animal qui dort sur le canapé", 1);

    expect(results[0]?.path).toBe("chat.md");
  }, 120_000);

  it("never indexes its own .synapse directory as memory content", async () => {
    writeFileSync(join(hub, "chat.md"), "Le chat dort sur le canapé.", "utf8");

    const results = await searchHub(hub, "chat", 10);

    expect(results.every((r) => !r.path.startsWith(".synapse"))).toBe(true);
    expect(existsSync(join(hub, ".synapse", "index.sqlite"))).toBe(true);
  }, 120_000);
});

describeWithModel("refreshHubIndex", () => {
  it("builds the index without running a search, ready for a later searchHub() call", async () => {
    writeFileSync(join(hub, "chat.md"), "Le chat dort sur le canapé toute la journée.", "utf8");

    await refreshHubIndex(hub);
    expect(existsSync(join(hub, ".synapse", "index.sqlite"))).toBe(true);

    // A later search shouldn't need to re-embed anything (fingerprint unchanged).
    const results = await searchHub(hub, "chat", 1);
    expect(results[0]?.path).toBe("chat.md");
  }, 120_000);
});

// Backlog 51 (16/10/2026) : le rappel proactif (hook UserPromptSubmit, 15 s)
// doit interroger l'index tel quel, jamais le reconstruire — voir
// search.ts/searchIndex pour la boucle de timeouts que ça corrige.
describeWithModel("searchHub en lecture seule ({ refreshIndex: false })", () => {
  it("ignore un fichier ajouté depuis la dernière reconstruction au lieu de l'embedder", async () => {
    writeFileSync(join(hub, "chat.md"), "Le chat dort sur le canapé toute la journée.", "utf8");
    await refreshHubIndex(hub);

    writeFileSync(join(hub, "voiture.md"), "La voiture roule vite sur l'autoroute.", "utf8");
    const results = await searchHub(hub, "un véhicule qui roule sur l'autoroute", 5, { refreshIndex: false });

    expect(results.map((r) => r.path)).not.toContain("voiture.md");
    expect(results.map((r) => r.path)).toContain("chat.md");

    // La reconstruction suivante (SessionStart / Stop) rattrape le fichier.
    const after = await searchHub(hub, "un véhicule qui roule sur l'autoroute", 1);
    expect(after[0]?.path).toBe("voiture.md");
  }, 120_000);
});
