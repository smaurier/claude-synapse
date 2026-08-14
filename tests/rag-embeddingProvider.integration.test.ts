import { describe, it, expect, vi } from "vitest";
import { chunkFileForEmbedding, embedLocal } from "../src/rag/embeddingProvider.js";

// Real model, real tokenizer — slower than the rest of the suite (model
// load + WASM inference), kept in its own file for that reason. This is
// the actual proof the token-aware chunking holds, not an assumption:
// every produced chunk is re-encoded by the SAME tokenizer that will run
// at embedding time and checked against the true 128-token limit.

const FRENCH_MARKDOWN_SAMPLE = `
Décision du 22/07/2026 (suite remarque d'un collègue « tu pourrais le vendre ») : PAS de
produit payant (risque plateforme, niche, zéro douve) — mais une version générique et saine en
open-source, c'est LE volet qui intéresse Sylvain (la vitrine GitHub et l'article LinkedIn sont
annexes pour lui). Forme retenue : un plugin Claude Code (marketplace GitHub, comme caveman) —
hooks + commandes + install, PAS un repo de scripts à copier. Totalement découplé du système
privé de Sylvain : module indépendant, installable seul. Nom tranché le 01/08/2026 : Synapse
(repo probable : claude-synapse). La synapse est le lien dans le cerveau — le nom porte la
thèse « don't sync — link ». Remplace le nom de travail claude-brain, pris par toroleapinc.

**Problème de conception n°2 (config utilisateur) tranché le 13/08.** Piloté par commandes,
jamais d'édition manuelle de fichier requise (\`/synapse-init\` au premier lancement,
\`/synapse-config show/set\` ensuite) — pattern repris de claudebase, pas de servo/outfit. Deux
couches : config partagée dans le repo hub lui-même (versionnée, synchronisée automatiquement),
config locale hors hub. Séquence de bootstrap : 1) config locale (URL) → 2) clone/pull du hub →
3) lecture de la config partagée → 4) création de la jonction → 5) vérification post-install.
`.repeat(3); // long enough to force multiple chunks

describe("chunkFileForEmbedding (real tokenizer)", () => {
  it("every chunk stays within the model's true token limit when re-encoded", async () => {
    const chunks = await chunkFileForEmbedding("sample.md", FRENCH_MARKDOWN_SAMPLE);

    expect(chunks.length).toBeGreaterThan(1); // confirms the sample actually needed chunking

    const { AutoTokenizer } = await import("@huggingface/transformers");
    const tokenizer = await AutoTokenizer.from_pretrained("Xenova/paraphrase-multilingual-MiniLM-L12-v2");

    for (const chunk of chunks) {
      const tokenCount = tokenizer.encode(chunk.text).length;
      expect(tokenCount).toBeLessThanOrEqual(128);
    }
  }, 120_000);
});

describe("embedLocal (real model)", () => {
  it("returns a 384-dimensional normalized vector for multilingual MiniLM", async () => {
    const vector = await embedLocal("test court");
    expect(vector).toHaveLength(384);
  }, 120_000);

  it("does not warn for a properly chunked input", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [chunk] = await chunkFileForEmbedding("sample.md", FRENCH_MARKDOWN_SAMPLE);
    await embedLocal(chunk!.text);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  }, 120_000);

  it("warns when given raw oversized text that bypassed chunking (the safety net actually fires)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await embedLocal(FRENCH_MARKDOWN_SAMPLE); // unchunked, well over 128 tokens
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dépasse la limite"));
    warnSpy.mockRestore();
  }, 120_000);
});
